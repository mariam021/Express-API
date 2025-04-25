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
router.get('/users/:user_id/',
  paginate,
  validateRequest([
    param('user_id').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const user_id = req.params.user_id;
    
    // Authorization check
    if (parseInt(user_id) !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access these contacts'
      });
    }
    
    const { limit, offset } = req.pagination;
    
    // Get contacts with their phone numbers in a single query
    const contactsResult = await db.query(`
      SELECT 
        c.id,
        c.user_id as "userId",
        c.name,
        c.is_emergency as "isEmergency",
        c.relationship,
        c.image,
        p.id as "phoneId",
        p.phone_number as "phoneNumber"
      FROM contacts c
      LEFT JOIN contact_phone_numbers p ON c.id = p.contact_id
      WHERE c.user_id = $1
      ORDER BY c.is_emergency DESC, c.name ASC
      LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    
    // Group contacts with their phone numbers
    const contactsMap = new Map();
    contactsResult.rows.forEach(row => {
      if (!contactsMap.has(row.id)) {
        contactsMap.set(row.id, {
          id: row.id,
          userId: row.userId,
          name: row.name,
          isEmergency: row.isEmergency,
          relationship: row.relationship,
          image: row.image,
          phoneNumbers: []
        });
      }
      
      if (row.phoneId) {
        contactsMap.get(row.id).phoneNumbers.push({
          id: row.phoneId,
          contactId: row.id,
          phoneNumber: row.phoneNumber
        });
      }
    });
    
    const contactsWithPhones = Array.from(contactsMap.values());
    
    // Get total count for pagination
    const countResult = await db.query(
      'SELECT COUNT(*) FROM contacts WHERE user_id = $1',
      [user_id]
    );
    
    res.status(200).json({
      success: true,
      message: 'Contacts retrieved successfully',
      data: contactsWithPhones,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: Math.ceil(offset / limit) + 1,
        limit: limit,
        pages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
      }
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
         ORDER BY contact_id ASC`,
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