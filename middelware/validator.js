// middleware/validator.js
import { validationResult } from 'express-validator';
import { apiResponse } from '../libs/utils.js';

export const validateRequest = (validations) => {
  return async (req, res, next) => {
    // Execute all validations
    await Promise.all(validations.map(validation => validation.run(req)));
    
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return apiResponse(res, 400, null, 'Validation error', errors.array());
    }
    
    next();
  };
};