// routes/contacts.js
import express from 'express';
import { body, param, query } from 'express-validator';
import db from '../lib/db.js';
import { apiResponse, asyncHandler, authenticate, paginate } from '../lib/utils.js';
import { validateRequest } from '../middleware/validator.js';

const router = express.Router();

// Apply authentication to all contact routes
router.use(authenticate);

// Get all contacts for a user
router.get('/',
  paginate,
  validateRequest([
    query('user_id').optional().isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    // Get user_id from query or from authenticated user
    const user_id = req.query.user_id || req.user.userId;
    
    // Ensure user can only access their own contacts
    if (parseInt(user_id) !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to access these contacts');
    }
    
    const { limit, offset } = req.pagination;
    
    const contacts = await db.query(
      `SELECT * FROM contacts
       WHERE user_id = $1
       ORDER BY is_emergency DESC, name ASC
       LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    
    // Get total count for pagination
    const countResult = await db.query(
      'SELECT COUNT(*) FROM contacts WHERE user_id = $1',
      [user_id]
    );
    
    const totalCount = parseInt(countResult.rows[0].count);
    
    const contactsWithPhones = await Promise.all(
      contacts.rows.map(async contact => {
        const phones = await db.query(
          `SELECT * FROM contact_phone_numbers
           WHERE contact_id = $1`,
          [contact.id]
        );
        return { ...contact, phone_numbers: phones.rows };
      })
    );
    
    apiResponse(res, 200, {
      contacts: contactsWithPhones,
      pagination: {
        total: totalCount,
        page: req.pagination.page,
        limit: req.pagination.limit,
        pages: Math.ceil(totalCount / limit)
      }
    });
  })
);

// Get contact by ID
router.get('/:id',
  validateRequest([
    param('id').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const contact = await db.query(
      `SELECT * FROM contacts WHERE id = $1`,
      [id]
    );
    
    if (contact.rows.length === 0) {
      return apiResponse(res, 404, null, 'Contact not found');
    }
    
    // Ensure user can only access their own contacts
    if (contact.rows[0].user_id !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to access this contact');
    }
    
    const phones = await db.query(
      `SELECT * FROM contact_phone_numbers WHERE contact_id = $1`,
      [id]
    );
    
    apiResponse(res, 200, {
      ...contact.rows[0],
      phone_numbers: phones.rows
    });
  })
);

// Create contact
router.post('/',
  validateRequest([
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('is_emergency').optional().isBoolean(),
    body('relationship').optional().trim(),
    body('image').optional().trim(),
    body('phone_numbers').optional().isArray()
  ]),
  asyncHandler(async (req, res) => {
    // Always use the authenticated user's ID
    const user_id = req.user.userId;
    const { name, is_emergency = false, relationship, image, phone_numbers = [] } = req.body;
    
    await db.transaction(async (client) => {
      // Insert contact
      const contactResult = await client.query(
        `INSERT INTO contacts
         (user_id, name, is_emergency, relationship, image)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [user_id, name, is_emergency, relationship, image]
      );
      
      const contact = contactResult.rows[0];
      
      // Insert phone numbers if provided
      if (phone_numbers.length > 0) {
        for (const phone of phone_numbers) {
          await client.query(
            `INSERT INTO contact_phone_numbers
             (contact_id, phone_number, phone_type, is_primary)
             VALUES ($1, $2, $3, $4)`,
            [contact.id, phone.phone_number, phone.phone_type || 'mobile', phone.is_primary || false]
          );
        }
      }
      
      // Get full contact with phones
      const phones = await client.query(
        'SELECT * FROM contact_phone_numbers WHERE contact_id = $1',
        [contact.id]
      );
      
      apiResponse(res, 201, {
        ...contact,
        phone_numbers: phones.rows
      }, 'Contact created successfully');
    });
  })
);

// Update contact
router.put('/:id',
  validateRequest([
    param('id').isInt().toInt(),
    body('name').optional().trim().notEmpty(),
    body('is_emergency').optional().isBoolean(),
    body('relationship').optional().trim(),
    body('image').optional().trim()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, is_emergency, relationship, image } = req.body;
    
    // Check if contact belongs to user
    const contactCheck = await db.query(
      'SELECT user_id FROM contacts WHERE id = $1',
      [id]
    );
    
    if (contactCheck.rows.length === 0) {
      return apiResponse(res, 404, null, 'Contact not found');
    }
    
    if (contactCheck.rows[0].user_id !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to update this contact');
    }
    
    const result = await db.query(
      `UPDATE contacts SET
        name = COALESCE($1, name),
        is_emergency = COALESCE($2, is_emergency),
        relationship = COALESCE($3, relationship),
        image = COALESCE($4, image),
        updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, is_emergency, relationship, image, id]
    );
    
    apiResponse(res, 200, result.rows[0], 'Contact updated successfully');
  })
);

// Delete contact
router.delete('/:id',
  validateRequest([
    param('id').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    // Check if contact belongs to user
    const contactCheck = await db.query(
      'SELECT user_id FROM contacts WHERE id = $1',
      [id]
    );
    
    if (contactCheck.rows.length === 0) {
      return apiResponse(res, 404, null, 'Contact not found');
    }
    
    if (contactCheck.rows[0].user_id !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to delete this contact');
    }
    
    await db.transaction(async (client) => {
      // Delete phone numbers first
      await client.query(
        `DELETE FROM contact_phone_numbers
         WHERE contact_id = $1`,
        [id]
      );
      
      // Then delete contact
      await client.query(
        `DELETE FROM contacts
         WHERE id = $1`,
        [id]
      );
      
      apiResponse(res, 204, null, 'Contact deleted successfully');
    });
  })
);

export default router;