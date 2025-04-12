// routes/users.js
import express from 'express';
import { body, param } from 'express-validator';
import bcrypt from 'bcryptjs';
import db from '../libs/db.js';
import { apiResponse, asyncHandler, authenticate } from '../libs/utils.js';
import { validateRequest } from '../middleware/validator.js';

const router = express.Router();
router.get('/', (req, res) => {
  res.json({
    message: "Users API Endpoints",
    endpoints: {
      get_current_user: "GET /me (requires auth)",
      get_user_by_id: "GET /:id",
      update_user: "PUT /:id (requires auth)",
      delete_user: "DELETE /:id (requires auth)"
    }
  });
});
// Get current user profile
router.get('/me', 
  //authenticate,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT id, name, age, mac, phone_number, image
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
      `SELECT id, name, age, mac, phone_number, image
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
  //authenticate,
  validateRequest([
    param('id').isInt().toInt(),
    body('name').optional().trim().notEmpty(),
    body('password').optional().isLength({ min: 6 }),
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
      RETURNING id, name, age, mac, phone_number, image
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