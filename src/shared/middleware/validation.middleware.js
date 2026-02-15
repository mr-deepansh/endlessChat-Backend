// src/shared/middleware/validation.middleware.js
import { body, validationResult } from "express-validator";
import { ApiError } from "../utils/ApiError.js";

/**
 * Handle validation results
 */
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
      value: error.value,
    }));

    throw new ApiError(400, "Validation failed", errorMessages);
  }
  next();
};

/**
 * Validate request middleware
 */
export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
      value: error.value,
    }));

    throw new ApiError(400, "Validation failed", errorMessages);
  }
  next();
};

/**
 * Registration validation rules
 */

export const validateRegistration = [
  body("username")
    .isLength({ min: 3, max: 30 })
    .withMessage("Username must be between 3 and 30 characters")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username can only contain letters, numbers, and underscores")
    .toLowerCase(),

  body("email").isEmail().withMessage("Please provide a valid email address").normalizeEmail(),

  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain at least one uppercase letter, one lowercase letter, and one number"),

  body("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error("Passwords do not match");
    }
    return true;
  }),

  body("firstName").trim().isLength({ min: 1 }).withMessage("First name is required"),

  body("lastName").trim().isLength({ min: 1 }).withMessage("Last name is required"),

  handleValidationErrors,
];

/**
 * Login validation rules
 */
export const validateLogin = [
  body("identifier").trim().isLength({ min: 1 }).withMessage("Username or email is required"),

  body("password").isLength({ min: 1 }).withMessage("Password is required"),

  handleValidationErrors,
];

/**
 * Password reset validation rules
 */
export const validatePasswordReset = [
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain at least one uppercase letter, one lowercase letter, and one number"),

  body("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error("Passwords do not match");
    }
    return true;
  }),

  handleValidationErrors,
];

/**
 * Email validation rules
 */
export const validateEmail = [
  body("email").isEmail().withMessage("Please provide a valid email address").normalizeEmail(),

  handleValidationErrors,
];
