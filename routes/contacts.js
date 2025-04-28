import express from 'express';
import { body, param, query } from 'express-validator';
import db from '../libs/db.js';
import { apiResponse, asyncHandler, authenticate, paginate } from '../libs/utils.js';
import { validateRequest } from '../middleware/validator.js';

const router = express.Router();

// Apply authentication to all contact routes
router.use(authenticate);

// Get all contacts for a user
router.get('/users/:userId/',
  paginate,
  validateRequest([
    param('userId').isInt().toInt()
  ]),
  asyncHandler(async (req, res) => {
    const userId = req.params.userId;
    
    // Authorization check
    if (parseInt(userId) !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access these contacts'
      });
    }
    
    const { limit, offset } = req.pagination;
    
    // Get contacts with their phone numbers
    const contactsResult = await db.query(`
      SELECT 
        c.id,
        c.userId,
        c.name,
        c.is_emergency,
        c.relationship,
        c.image,
        p.id as "phoneId",
        p.phone_number
      FROM contacts c
      LEFT JOIN contact_phone_numbers p ON c.id = p.contact_id
      WHERE c.userId = $1
      ORDER BY c.is_emergency DESC, c.name ASC
      LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    
    // Group contacts with their phone numbers
    const contactsMap = new Map();
    contactsResult.rows.forEach(row => {
      if (!contactsMap.has(row.id)) {
        contactsMap.set(row.id, {
          id: row.id,
          userId: row.userId,
          name: row.name,
          is_emergency: row.is_emergency,
          relationship: row.relationship,
          image: row.image,
          phone_numbers: [] // Using the correct field name expected by Android
        });
      }
      
      if (row.phoneId) {
        contactsMap.get(row.id).phone_numbers.push({
          id: row.phoneId,
          contactId: row.id,
          phone_number: row.phone_number
        });
      }
    });
    
    // Get total count for pagination
    const countResult = await db.query(
      'SELECT COUNT(*) FROM contacts WHERE userId = $1',
      [userId]
    );
    
    res.status(200).json({
      success: true,
      message: 'Contacts retrieved successfully',
      data: Array.from(contactsMap.values()),
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
// In your contact creation route
router.post('/', 
  validateRequest([
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('isEmergency').optional().isBoolean(),
    body('relationship').optional().trim(),
    body('image').optional().trim(),
    body('phoneNumbers').optional().isArray()
  ]),
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { name, is_emergency = false, relationship, image, phone_numbers = [] } = req.body;
    
    await db.transaction(async (client) => {
      // Insert contact
      const contactResult = await client.query(
        `INSERT INTO contacts
         (userId, name, is_emergency, relationship, image)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, name, isEmergency, relationship, image]
      );
      
      const contact = contactResult.rows[0];
      
      // Insert phone numbers if provided
      const insertedPhones = [];
      if (phone_numbers.length > 0) {
        for (const phone of phone_numbers) {
          const phoneResult = await client.query(
            `INSERT INTO contact_phone_numbers
             (contact_id, phone_number)
             VALUES ($1, $2)
             RETURNING id, contact_id as "contactId", phone_number as "phoneNumber"`,
            [contact.id, phone.phoneNumber]
          );
          insertedPhones.push(phoneResult.rows[0]);
        }
      }
      
      apiResponse(res, 201, {
        id: contact.id,
        userId: contact.userId,
        name: contact.name,
        is_emergency: contact.is_emergency,
        relationship: contact.relationship,
        image: contact.image,
        phone_numbers: insertedPhones // Include the inserted phone numbers
      }, 'Contact created successfully');
    });
  })
);

// Update contact
router.put('/:id',
  validateRequest([
    param('id').isInt().toInt(),
    body('name').optional().trim().notEmpty(),
    body('isEmergency').optional().isBoolean(),
    body('relationship').optional().trim(),
    body('image').optional().trim(),
    body('phoneNumbers').optional().isArray()
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, isEmergency, relationship, image, phoneNumbers } = req.body;
    
    // Check if contact belongs to user
    const contactCheck = await db.query(
      'SELECT userId FROM contacts WHERE id = $1',
      [id]
    );
    
    if (contactCheck.rows.length === 0) {
      return apiResponse(res, 404, null, 'Contact not found');
    }
    
    if (contactCheck.rows[0].userId !== req.user.userId) {
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
        [name, isEmergency, relationship, image, id]
      );
      
      const contact = result.rows[0];
      
      // Update phone numbers if provided
      if (phoneNumbers) {
        // Delete existing phone numbers
        await client.query(
          `DELETE FROM contact_phone_numbers WHERE contact_id = $1`,
          [id]
        );
        
        // Insert new phone numbers
        if (phoneNumbers.length > 0) {
          const phoneValues = phoneNumbers.map(phone => [
            id,
            phone.phoneNumber
          ]);
          
          await client.query(
            `INSERT INTO contact_phone_numbers
             (contact_id, phone_number)
             VALUES ${phoneValues.map((_, i) => `($${i*2+1}, $${i*2+2})`).join(',')}`,
            phoneValues.flat()
          );
        }
      }
      
      // Get updated contact with phones
      const phones = await client.query(
        `SELECT id, contact_id as "contactId", phone_number as "phoneNumber"
         FROM contact_phone_numbers 
         WHERE contact_id = $1`,
        [id]
      );
      
      apiResponse(res, 200, {
        id: contact.id,
        userId: contact.userId,
        name: contact.name,
        isEmergency: contact.is_emergency,
        relationship: contact.relationship,
        image: contact.image,
        phoneNumbers: phones.rows
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
      'SELECT userId FROM contacts WHERE id = $1',
      [id]
    );
    
    if (contactCheck.rows.length === 0) {
      return apiResponse(res, 404, null, 'Contact not found');
    }
    
    if (contactCheck.rows[0].userId !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to delete this contact');
    }
    
    await db.transaction(async (client) => {
      // Delete phone numbers first
      await client.query(
        `DELETE FROM contact_phone_numbers WHERE contact_id = $1`,
        [id]
      );
      
      // Then delete contact
      await client.query(
        `DELETE FROM contacts WHERE id = $1`,
        [id]
      );
      
      apiResponse(res, 204, null, 'Contact deleted successfully');
    });
  })
);

export default router;