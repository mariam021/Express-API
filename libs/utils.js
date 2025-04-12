// lib/utils.js
import jwt from 'jsonwebtoken';

// Standard API response formatter
export const apiResponse = (res, status, data, message = '') => {
  const response = { success: status >= 200 && status < 300 };
  if (message) response.message = message;
  if (data !== undefined && data !== null) response.data = data;

  return res.status(status).json(response);
};

// Error handler middleware
export const errorHandler = (err, req, res, next) => {
  console.error('API Error:', err);

  const status = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  apiResponse(res, status, null, message);
};

// Async middleware wrapper
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// JWT middleware for authentication
/*
export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return apiResponse(res, 401, null, 'Authentication required');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return apiResponse(res, 401, null, 'Invalid or expired token');
  }
};
*/
export const authenticate = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) throw new Error('Authentication required');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { userId: decoded.userId }; // Ensure this matches your token payload
    next();
  } catch (err) {
    apiResponse(res, 401, null, err.message);
  }
};

// JWT token generator
/*
export const generateToken = (payload, expiresIn = '24h') => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};*/
export const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { 
    expiresIn: '24h' 
  });
};
// Sanitize phone number format
export const sanitizePhoneNumber = (phone) => {
  if (!phone) return null;
  return phone.replace(/[^\d+]/g, '');
};

// Pagination helper
export const paginate = (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  
  req.pagination = {
    page,
    limit,
    offset: (page - 1) * limit
  };
  
  next();
};