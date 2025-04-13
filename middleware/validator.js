// middleware/validator.js
import { validationResult } from 'express-validator';
import { apiResponse } from '../libs/utils.js';

export const validateRequest = (validations) => {
  return async (req, res, next) => {
    try {
      // Run all validations in parallel
      await Promise.all(validations.map(validation => validation.run(req)));
      
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        // Format errors for better client consumption
        const formattedErrors = errors.array().map(error => ({
          param: error.param,
          message: error.msg,
          location: error.location,
          value: error.value
        }));
        
        return apiResponse(
          res, 
          400, 
          { errors: formattedErrors }, 
          'Validation failed', 
          null
        );
      }
      
      next();
    } catch (error) {
      console.error('Validation middleware error:', error);
      return apiResponse(
        res, 
        500, 
        null, 
        'Internal server error during validation', 
        null
      );
    }
  };
};