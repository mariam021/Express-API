import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { apiResponse, asyncHandler, authenticate } from '../libs/utils.js';

const router = express.Router();

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); // Use the uploads directory
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/i;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype) || file.mimetype === 'image/jpg';
    console.log(`File: ${file.originalname}, MIME: ${file.mimetype}, Ext: ${path.extname(file.originalname)}`);
    if (extname && (mimetype || file.mimetype === 'image/jpg')) {
      return cb(null, true);
    }
    cb(new Error('Only JPEG and PNG images are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Serve uploaded images statically
router.use('/uploads', express.static(uploadDir));

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