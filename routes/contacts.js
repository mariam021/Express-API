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
    
    if (parseInt(user_id) !== req.user.userId) {
      return apiResponse(res, 403, null, 'Not authorized to access these contacts');
    }
    
    const { limit, offset } = req.pagination;
    
    // Get contacts with pagination
    const contacts = await db.query(
      `SELECT 
        c.id,
        c.user_id as "userId",
        c.name,
        c.is_emergency as "isEmergency",
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
    
    // Get phone numbers for all contacts
    const contactIds = contacts.rows.map(c => c.id);
    let phones = [];
    
    if (contactIds.length > 0) {
      const phonesResult = await db.query(
        `SELECT 
          id,
          contact_id as "contactId",
          phone_number as "phoneNumber"
         FROM contact_phone_numbers
         WHERE contact_id = ANY($1)`,
        [contactIds]
      );
      phones = phonesResult.rows;
    }
    
    // Format response
    const contactsWithPhones = contacts.rows.map(contact => ({
      id: contact.id,
      userId: contact.userId,
      name: contact.name,
      isEmergency: contact.isEmergency,
      relationship: contact.relationship,
      image: contact.image,
      phoneNumbers: phones
        .filter(p => p.contactId === contact.id)
        .map(p => ({
          id: p.id,
          contactId: p.contactId,
          phoneNumber: p.phoneNumber
        }))
    }));
    
    // Return properly formatted ApiResponse
    res.status(200).json({
      success: true,
      message: 'Contacts retrieved successfully',
      data: contactsWithPhones
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