// server.js - Updated Main entry point
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path'; // Add path import
import { errorHandler } from './libs/utils.js';

// Routes
import userRoutes from './routes/users.js';
import contactRoutes from './routes/contacts.js';
import phoneNumberRoutes from './routes/phoneNumbers.js';
import authRoutes from './routes/auth.js';
import imageRoutes from './routes/images.js';

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON bodies
app.use(morgan('dev')); // Logging

// Set up static file serving for uploads directory directly
// This is crucial for making uploads accessible
app.use('/api/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/phone-numbers', phoneNumberRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/images', imageRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Contact Management API' });
});

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;