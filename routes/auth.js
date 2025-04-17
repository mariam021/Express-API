// routes/auth.js
import express from 'express';
import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import db from '../libs/db.js';
import { authenticate } from '../libs/utils.js';
import { apiResponse, asyncHandler, generateToken } from '../libs/utils.js';
import { validateRequest } from '../middleware/validator.js';

const router = express.Router();

// Login route
router.post('/login', 
  validateRequest([
    body('phone_number').trim().notEmpty().withMessage('Phone number is required'),
    body('password').notEmpty().withMessage('Password is required')
  ]),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    
    // Find user by username
    const result = await db.query(
      'SELECT * FROM users WHERE name = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return apiResponse(res, 401, null, 'Invalid credentials');
    }
    
    const user = result.rows[0];
    
    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return apiResponse(res, 401, null, 'Invalid credentials');
    }
    
    // Generate token
    const token = generateToken({ userId: user.id });
    
    // Return user data and token
    apiResponse(res, 200, {
      success: true,
      data: { // Wrap in data object to match your client expectations
        token: token,
        user: {
          id: user.id,
          name: user.name,
          phoneNumber: user.phone_number
        }
      },
      expiry: 60 * 60 * 24 * 7 // 7 days in seconds
    });
  })
);

// Register route
router.post('/register',
  validateRequest([
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('phone_number').isMobilePhone().withMessage('Valid phone number is required')
  ]),
  asyncHandler(async (req, res) => {
    const { name, password, age, mac, phone_number, image } = req.body;
    
    // Check if user already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE name = $1',
      [name]
    );
    
    if (existingUser.rows.length > 0) {
      return apiResponse(res, 400, null, 'User already exists');
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const result = await db.query(
      `INSERT INTO users 
       (name, password, age, mac, phone_number, image)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, age, mac, phone_number, image`,
      [name, hashedPassword, age, mac, phone_number, image]
    );
    
    const user = result.rows[0];
    
    // Generate token
    const token = generateToken({ userId: user.id });
    
    apiResponse(res, 201, { user, token }, 'User registered successfully');
  })
);

router.post('/refresh', 
  authenticate,
  asyncHandler(async (req, res) => {
    // Generate new token with same user ID
    const token = generateToken({ userId: req.user.userId });
    
    apiResponse(res, 200, {
      success: true,
      data: {
        token: token
      },
      expiry: 60 * 60 * 24 * 7 // 7 days in seconds
    });
  })
);


export default router;