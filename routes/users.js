// routes/users.js
import express from 'express';
import { body, param } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../libs/db.js';
import { apiResponse, asyncHandler, authenticate } from '../libs/utils.js';
import { validateRequest } from '../middleware/validator.js';

const router = express.Router();

// Token generation function
function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// List all API endpoints
router.get('/', (req, res) => {
  res.json({
    message: "Users API Endpoints",
    endpoints: {
      create_user: "POST /signup",
      get_all_users: "GET /all",
      get_current_user: "GET /me (requires auth)",
      get_user_by_id: "GET /:id",
      update_user: "PUT /:id (requires auth)",
      delete_user: "DELETE /:id (requires auth)",
      login: "POST /login"
    }
  });
});

// Create new user with auto-login
router.post('/signup',
  validateRequest([
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('age').optional().isInt({ min: 1 }).withMessage('Age must be a positive integer'),
    body('mac').optional().isMACAddress().withMessage('Invalid MAC address format'),
    body('phone_number')
      .trim()
      .notEmpty()
      .withMessage('Phone number is required')
      .customSanitizer(value => value.replace(/[^\d+]/g, ''))
      .isLength({ min: 8, max: 15 })
      .withMessage('Phone number must be between 8-15 digits'),
    body('image').optional().isURL().withMessage('Invalid image URL')
  ]),
  asyncHandler(async (req, res) => {
    const { name, password, age, mac, phone_number, image } = req.body;

    // Check if user already exists (by phone number)
    const existingUser = await db.query(
      'SELECT id FROM users WHERE phone_number = $1',
      [phone_number]
    );

    if (existingUser.rows.length > 0) {
      return apiResponse(res, 409, null, 'User with this phone number already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const result = await db.query(
      `INSERT INTO users 
       (name, password, age, mac, phone_number, image) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, name, age, mac, phone_number as "phoneNumber", image`,
      [name, hashedPassword, age, mac, phone_number, image]
    );

    const user = result.rows[0];
    
    // Generate token for auto-login
    const token = generateToken({ userId: user.id });
    
    // Return user data with token
    apiResponse(res, 201, {
      token,
      user: {
        id: user.id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        age: user.age,
        mac: user.mac,
        image: user.image
      }
    }, 'User created and logged in successfully');
  })
);

// Get all users (paginated)
router.get('/all',
  asyncHandler(async (req, res) => {
    // Get pagination parameters from query string
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Get total count of users
    const countResult = await db.query('SELECT COUNT(*) FROM users');
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    // Get paginated users
    const result = await db.query(
      `SELECT id, name, age, mac, phone_number as "phoneNumber", image
       FROM users 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    apiResponse(res, 200, {
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1
      }
    });
  })
);

// User Login
router.post('/login',
  validateRequest([
    body('username') // Changed from phone_number to username
      .trim()
      .notEmpty()
      .withMessage('Username is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
  ]),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    // 1. Find user by username
    const userResult = await db.query(
      `SELECT id, name, password FROM users WHERE name = $1`,
      [username]
    );

    if (userResult.rows.length === 0) {
      return apiResponse(res, 401, null, 'Invalid credentials');
    }

    const user = userResult.rows[0];

    // 2. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return apiResponse(res, 401, null, 'Invalid credentials');
    }

    // 3. Generate JWT token
    const token = generateToken({ userId: user.id });

    // 4. Return properly formatted response
    apiResponse(res, 200, {
      success: true,
      token: token,
      user: {
        id: user.id,
        name: user.name
      }
    });
  })
);

// Get current user profile
router.get('/me', 
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT id, name, age, mac, phone_number as "phoneNumber", image
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    
    if (result.rows.length === 0) {
      return apiResponse(res, 404, null, 'User not found');
    }
    
    apiResponse(res, 200, result.rows[0]);
  })
);

// Get user by ID
router.get('/:id',
  validateRequest([
    param('id').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const result = await db.query(
      `SELECT id, name, age, mac, phone_number as "phoneNumber", image
       FROM users WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return apiResponse(res, 404, null, 'User not found');
    }
    
    apiResponse(res, 200, result.rows[0]);
  })
);

// Update user
router.put('/:id',
  authenticate,
  validateRequest([
    param('id').isInt().toInt(),
    body('name').optional().trim().notEmpty(),
    body('password').optional().isLength({ min: 8 }),
    body('age').optional().isInt({ min: 1 }),
    body('mac').optional().isMACAddress(),
    body('phone_number').optional().isMobilePhone(),
    body('image').optional().isURL()
  ]),
  
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, password, age, mac, phone_number, image } = req.body;
    
    // Ensure user can only update their own profile
    if (parseInt(id) !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to update this user');
    }
    
    let updates = [];
    let values = [];
    let counter = 1;
    
    if (name) {
      updates.push(`name = $${counter}`);
      values.push(name);
      counter++;
    }
    
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.push(`password = $${counter}`);
      values.push(hashedPassword);
      counter++;
    }
    
    if (age !== undefined) {
      updates.push(`age = $${counter}`);
      values.push(age);
      counter++;
    }
    
    if (mac) {
      updates.push(`mac = $${counter}`);
      values.push(mac);
      counter++;
    }
    
    if (phone_number) {
      updates.push(`phone_number = $${counter}`);
      values.push(phone_number);
      counter++;
    }
    
    if (image) {
      updates.push(`image = $${counter}`);
      values.push(image);
      counter++;
    }
    
    if (updates.length === 0) {
      return apiResponse(res, 400, null, 'No valid fields to update');
    }
    
    updates.push(`updated_at = NOW()`);
    
    values.push(id);
    const query = `
      UPDATE users SET
        ${updates.join(', ')}
      WHERE id = $${counter}
      RETURNING id, name, age, mac, phone_number as "phoneNumber", image
    `;
    
    const result = await db.query(query, values);
    
    if (result.rows.length === 0) {
      return apiResponse(res, 404, null, 'User not found');
    }
    
    apiResponse(res, 200, result.rows[0], 'User updated successfully');
  })
);

// Delete user
router.delete('/:id',
  authenticate,
  validateRequest([
    param('id').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    // Ensure user can only delete their own account
    if (parseInt(id) !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to delete this user');
    }
    
    await db.transaction(async (client) => {
      // Delete related contacts and phone numbers
      await client.query('DELETE FROM contacts WHERE user_id = $1', [id]);
      
      // Delete the user
      const result = await client.query(
        'DELETE FROM users WHERE id = $1 RETURNING id',
        [id]
      );
      
      if (result.rows.length === 0) {
        return apiResponse(res, 404, null, 'User not found');
      }
      
      apiResponse(res, 204, null, 'User deleted successfully');
    });
  })
);

export default router;