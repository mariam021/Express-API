import express from 'express';
import multer from 'multer';
import path from 'path';
import { apiResponse, asyncHandler, authenticate } from '../libs/utils.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure this directory exists
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Allow jpeg, jpg, and png
    const filetypes = /jpeg|jpg|png/i; // Case-insensitive
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype) || file.mimetype === 'image/jpg';
    
    if (extname && (mimetype || file.mimetype === 'image/jpg')) {
      return cb(null, true);
    }
    cb(new Error('Only JPEG and PNG images are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Serve uploaded images statically
router.use('/uploads', express.static('uploads'));

// Upload image endpoint
router.post(
  '/upload',
  authenticate,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return apiResponse(res, 400, null, 'No image file provided');
    }

    // Construct the URL for the uploaded image
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    apiResponse(res, 200, { imageUrl }, 'Image uploaded successfully');
  })
);

export default router;