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
    });
  })
);

// Forgot Password - Reset using phone number
router.post('/forgot-password',
  validateRequest([
    body('phone_number').isMobilePhone(),
    body('new_password').isLength({ min: 8 })
  ]),
  asyncHandler(async (req, res) => {
    const { phone_number, new_password } = req.body;

    // 1. Check if the user exists
    const userResult = await db.query(
      'SELECT id FROM users WHERE phone_number = $1',
      [phone_number]
    );

    if (userResult.rows.length === 0) {
      return apiResponse(res, 404, null, 'User with this phone number does not exist');
    }

    // 2. Hash the new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // 3. Update the password
    await db.query(
      'UPDATE users SET password = $1 WHERE phone_number = $2',
      [hashedPassword, phone_number]
    );

    // 4. Respond
    apiResponse(res, 200, { success: true }, 'Password has been reset successfully');
  })
);

router.post('/send-reset-code',
  validateRequest([
    body('phone_number').isMobilePhone()
  ]),
  asyncHandler(async (req, res) => {
    const { phone_number } = req.body;

    // Check user exists
    const userResult = await db.query(
      'SELECT id FROM users WHERE phone_number = $1',
      [phone_number]
    );

    if (userResult.rows.length === 0) {
      return apiResponse(res, 404, null, 'User with this phone number does not exist');
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Save to temporary table or cache (in-memory for simplicity)
    await db.query(
      'INSERT INTO password_reset_codes (phone_number, code, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'10 minutes\')',
      [phone_number, code]
    );

    // TODO: Send SMS here (use Twilio or any SMS service)
    console.log(`Send SMS to ${phone_number} with code: ${code}`);

    return apiResponse(res, 200, { success: true }, 'Reset code sent via SMS');
  })
);

router.post('/verify-reset-code',
  validateRequest([
    body('phone_number').isMobilePhone(),
    body('code').isLength({ min: 6, max: 6 })
  ]),
  asyncHandler(async (req, res) => {
    const { phone_number, code } = req.body;

    const result = await db.query(
      'SELECT * FROM password_reset_codes WHERE phone_number = $1 AND code = $2 AND expires_at > NOW()',
      [phone_number, code]
    );

    if (result.rows.length === 0) {
      return apiResponse(res, 400, null, 'Invalid or expired code');
    }

    // Optionally: delete code after use
    await db.query('DELETE FROM password_reset_codes WHERE phone_number = $1', [phone_number]);

    return apiResponse(res, 200, { verified: true }, 'Code verified');
  })
);



export default router;