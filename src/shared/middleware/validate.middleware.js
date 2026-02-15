// src/shared/middleware/validate.middleware.js
import { ApiError } from "../utils/ApiError.js";

export const validateRequest = (schema) => {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.body);

      if (!result.success) {
        const errorMessage = result.error.errors.map((error) => error.message).join(", ");

        throw new ApiError(400, errorMessage);
      }

      // Replace req.body with validated data
      req.body = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateQuery = (schema) => {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.query);

      if (!result.success) {
        const errorMessage = result.error.errors.map((error) => error.message).join(", ");

        throw new ApiError(400, errorMessage);
      }

      // Replace req.query with validated data
      req.query = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateParams = (schema) => {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.params);

      if (!result.success) {
        const errorMessage = result.error.errors.map((error) => error.message).join(", ");

        throw new ApiError(400, errorMessage);
      }

      // Replace req.params with validated data
      req.params = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
};
