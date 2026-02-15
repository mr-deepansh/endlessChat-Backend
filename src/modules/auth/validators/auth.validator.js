// src/modules/auth/validators/auth.validator.js

import { z } from "zod";
import { VALIDATION, MESSAGES } from "../../../shared/constants/index.js";

/**
 * Email verification token validation
 */
export const verifyEmailSchema = z.object({
  token: z
    .string({
      required_error: MESSAGES.AUTH.TOKEN_REQUIRED,
      invalid_type_error: "Token must be a string",
    })
    .min(32, "Invalid token format")
    .max(512, "Invalid token format")
    .regex(/^[a-zA-Z0-9+/=:]+$/, "Invalid token format"),
});

/**
 * Validation middleware factory
 */
export const validateAuth = (schema) => {
  return (req, res, next) => {
    try {
      const validatedData = schema.parse(req.body);
      req.body = validatedData;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));

        return res.status(400).json({
          success: false,
          message: MESSAGES.VALIDATION.INVALID_INPUT,
          errors,
        });
      }

      return res.status(400).json({
        success: false,
        message: "Validation failed",
      });
    }
  };
};

/**
 * Parameter validation for routes with params
 */
export const validateParams = (schema) => {
  return (req, res, next) => {
    try {
      const validatedData = schema.parse(req.params);
      req.params = validatedData;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));

        return res.status(400).json({
          success: false,
          message: MESSAGES.VALIDATION.INVALID_INPUT,
          errors,
        });
      }

      return res.status(400).json({
        success: false,
        message: "Parameter validation failed",
      });
    }
  };
};
