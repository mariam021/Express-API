// routes/contacts.js
import express from 'express';
import { body, param, query } from 'express-validator';
import db from '../libs/db.js';
import { apiResponse, asyncHandler, authenticate, paginate } from '../libs/utils.js';
import { validateRequest } from '../middleware/validator.js';

const router = express.Router();

// Apply authentication to all contact routes
router.use(authenticate);

// Get all contacts for a user
router.get('/users/:user_id',
  paginate,
  validateRequest([
    param('user_id').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    // Get user_id from query or from authenticated user
    const user_id = req.query.user_id || req.user.userId;
    
    // Ensure user can only access their own contacts
    if (parseInt(user_id) !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to access these contacts');
    }
    
    const { limit, offset } = req.pagination;
    
    // Get contacts with pagination
    const contacts = await db.query(
      `SELECT 
        c.id,
        c.name,
        c.is_emergency,
        c.relationship,
        c.image,
        COUNT(p.id) as phone_count
       FROM contacts c
       LEFT JOIN contact_phone_numbers p ON c.id = p.contact_id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.is_emergency DESC, c.name ASC
       LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    
    // Get total count for pagination
    const countResult = await db.query(
      'SELECT COUNT(*) FROM contacts WHERE user_id = $1',
      [user_id]
    );
    
    const totalCount = parseInt(countResult.rows[0].count);
    
    // Get phone numbers for all contacts in a single query
    const contactIds = contacts.rows.map(c => c.id);
    let phones = [];
    
    if (contactIds.length > 0) {
      const phonesResult = await db.query(
        `SELECT * FROM contact_phone_numbers
         WHERE contact_id = ANY($1)
         ORDER BY contact_id ASC`,
        [contactIds]
      );
      phones = phonesResult.rows;
    }
    
    // Combine contacts with their phone numbers
    const contactsWithPhones = contacts.rows.map(contact => {
      return {
        ...contact,
        phone_numbers: phones.filter(p => p.contact_id === contact.id)
      };
    });
    
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
      `SELECT * FROM contact_phone_numbers 
       WHERE contact_id = $1
       ORDER BY contact_id ASC`,
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
    body('relationship').optional().trim(),
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
        const phoneValues = phone_numbers.map(phone => [
          contact.id,
          phone.phone_number
        ]);
        
        await client.query(
          `INSERT INTO contact_phone_numbers
           (contact_id, phone_number)
           VALUES ${phoneValues.map((_, i) => 
             `($${i*2+1}, $${i*2+2})`  // Only 2 parameters per row
           ).join(',')}`,
          phoneValues.flat()
        );
      }
      
      // Get full contact with phones
      const phones = await client.query(
        `SELECT * FROM contact_phone_numbers 
         WHERE contact_id = $1
         ORDER BY contact_id ASC`,
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
    body('image').optional().trim(),
    body('phone_numbers').optional().isArray()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, is_emergency, relationship, image, phone_numbers } = req.body;
    
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
    
    await db.transaction(async (client) => {
      // Update contact
      const result = await client.query(
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
      
      const contact = result.rows[0];
      
      // Update phone numbers if provided
      if (phone_numbers) {
        // Delete existing phone numbers
        await client.query(
          `DELETE FROM contact_phone_numbers
           WHERE contact_id = $1`,
          [id]
        );
        
        // Insert new phone numbers
        if (phone_numbers.length > 0) {
          const phoneValues = phone_numbers.map(phone => [
            id,
            phone.phone_number
          ]);
          
          await client.query(
            `INSERT INTO contact_phone_numbers
             (contact_id, phone_number)
             VALUES ${phoneValues.map((_, i) => 
               `($${i*2+1}, $${i*2+2})`  // Only 2 parameters per row
             ).join(',')}`,
            phoneValues.flat()
          );
        }
      }
      
      // Get updated contact with phones
      const phones = await client.query(
        `SELECT * FROM contact_phone_numbers 
         WHERE contact_id = $1
         ORDER contact_id ASC`,
        [id]
      );
      
      apiResponse(res, 200, {
        ...contact,
        phone_numbers: phones.rows
      }, 'Contact updated successfully');
    });
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