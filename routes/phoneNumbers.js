// routes/phoneNumbers.js
import express from 'express';
import { body, param } from 'express-validator';
import db from '../libs/db.js';
import { apiResponse, asyncHandler, authenticate } from '../libs/utils.js';
import { validateRequest } from '../middleware/validator.js';

const router = express.Router();

// Apply authentication to all phone number routes
router.use(authenticate);

// Get all phone numbers for a contact
router.get('/contact/:contactId',
  validateRequest([
    param('contactId').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const { contactId } = req.params;
    
    // Check if contact belongs to user
    const contactCheck = await db.query(
      'SELECT user_id FROM contacts WHERE id = $1',
      [contactId]
    );
    
    if (contactCheck.rows.length === 0) {
      return apiResponse(res, 404, null, 'Contact not found');
    }
    
    if (contactCheck.rows[0].user_id !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to access this contact');
    }
    
    const result = await db.query(
      `SELECT * FROM contact_phone_numbers
       WHERE contact_id = $1
       ORDER BY contact_id ASC`,
      [contactId]
    );
    
    apiResponse(res, 200, result.rows);
  })
);

// Get phone number by ID
router.get('/:id',
  validateRequest([
    param('id').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const phoneResult = await db.query(
      `SELECT cpn.* FROM contact_phone_numbers cpn
       JOIN contacts c ON cpn.contact_id = c.id
       WHERE cpn.id = $1`,
      [id]
    );
    
    if (phoneResult.rows.length === 0) {
      return apiResponse(res, 404, null, 'Phone number not found');
    }
    
    // Check if contact belongs to user
    const contactCheck = await db.query(
      'SELECT user_id FROM contacts WHERE id = $1',
      [phoneResult.rows[0].contact_id]
    );
    
    if (contactCheck.rows[0].user_id !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to access this phone number');
    }
    
    apiResponse(res, 200, phoneResult.rows[0]);
  })
);

// Create phone number
router.post('/',
  validateRequest([
    body('contact_id').isInt().toInt(),
    body('phone_number').trim().notEmpty()
  ]),
  asyncHandler(async (req, res) => {
    const { contact_id, phone_number } = req.body;
    
    // Check if contact belongs to user
    const contactCheck = await db.query(
      'SELECT user_id FROM contacts WHERE id = $1',
      [contact_id]
    );
    
    if (contactCheck.rows.length === 0) {
      return apiResponse(res, 404, null, 'Contact not found');
    }
    
    if (contactCheck.rows[0].user_id !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to add phone number to this contact');
    }
    
    await db.transaction(async (client) => {
      
      // Insert new phone number
      const result = await client.query(
        `INSERT INTO contact_phone_numbers
         (contact_id, phone_number)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [contact_id, phone_number]
      );
      
      apiResponse(res, 201, result.rows[0], 'Phone number added successfully');
    });
  })
);

// Update phone number
router.put('/:id',
  validateRequest([
    param('id').isInt().toInt(),
    body('phone_number').optional().trim().notEmpty()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { phone_number } = req.body;
    
    // Check if phone number exists and belongs to user's contact
    const phoneCheck = await db.query(
      `SELECT cpn.*, c.user_id FROM contact_phone_numbers cpn
       JOIN contacts c ON cpn.contact_id = c.id
       WHERE cpn.id = $1`,
      [id]
    );
    
    if (phoneCheck.rows.length === 0) {
      return apiResponse(res, 404, null, 'Phone number not found');
    }
    
    if (phoneCheck.rows[0].user_id !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to update this phone number');
    }
    
    await db.transaction(async (client) => {
      
      // Update phone number
      const result = await client.query(
        `UPDATE contact_phone_numbers SET
         phone_number = COALESCE($1, phone_number)
         WHERE id = $3
         RETURNING *`,
        [phone_number, id]
      );
      
      apiResponse(res, 200, result.rows[0], 'Phone number updated successfully');
    });
  })
);

// Delete phone number
router.delete('/:id',
  validateRequest([
    param('id').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    // Check if phone number exists and belongs to user's contact
    const phoneCheck = await db.query(
      `SELECT cpn.*, c.user_id FROM contact_phone_numbers cpn
       JOIN contacts c ON cpn.contact_id = c.id
       WHERE cpn.id = $1`,
      [id]
    );
    
    if (phoneCheck.rows.length === 0) {
      return apiResponse(res, 404, null, 'Phone number not found');
    }
    
    if (phoneCheck.rows[0].user_id !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to delete this phone number');
    }
    
    const result = await db.query(
      `DELETE FROM contact_phone_numbers
       WHERE id = $1
       RETURNING id`,
      [id]
    );
    
    apiResponse(res, 204, null, 'Phone number deleted successfully');
  })
);

export default router;