// src/shared/middleware/errorHandler.middleware.js
/**
 * Enterprise-grade centralized error handling middleware
 * @version 2.0.0
 * @author Deepansh Gangwar
 */

import { ApiError } from "../utils/ApiError.js";
import { logger } from "../services/logger.service.js";
import { HTTP_STATUS, MESSAGES } from "../constants/index.js";

/**
 * Production-grade error handler with security considerations
 */
export const errorHandler = (err, req, res, next) => {
  const startTime = Date.now();

  // Default error response
  let error = { ...err };
  error.message = err.message;

  // Log error details for monitoring
  const errorContext = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    userId: req.user?._id,
    timestamp: new Date().toISOString(),
    stack: err.stack,
  };

  // Handle different error types
  if (err.name === "CastError") {
    const message = "Invalid resource ID";
    error = new ApiError(HTTP_STATUS.BAD_REQUEST, message);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field} already exists`;
    error = new ApiError(HTTP_STATUS.CONFLICT, message);
  }

  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((val) => val.message)
      .join(", ");
    error = new ApiError(HTTP_STATUS.BAD_REQUEST, message);
  }

  if (err.name === "JsonWebTokenError") {
    const message = "Invalid token";
    error = new ApiError(HTTP_STATUS.UNAUTHORIZED, message);
  }

  if (err.name === "TokenExpiredError") {
    const message = "Token expired";
    error = new ApiError(HTTP_STATUS.UNAUTHORIZED, message);
  }

  // Log based on severity
  if (error.statusCode >= 500) {
    logger.error("Server Error", { ...errorContext, error: error.message });
  } else if (error.statusCode >= 400) {
    logger.warn("Client Error", { ...errorContext, error: error.message });
  }

  // Security: Don't expose sensitive information in production
  const isDevelopment = process.env.NODE_ENV === "development";

  const response = {
    success: false,
    message: error.message || MESSAGES.GENERAL.INTERNAL_ERROR,
    ...(isDevelopment && { stack: err.stack }),
    ...(error.data && { data: error.data }),
  };

  const executionTime = Date.now() - startTime;
  logger.info("Error handled", { executionTime: `${executionTime}ms`, statusCode: error.statusCode });

  res.status(error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR).json(response);
};

/**
 * Handle 404 errors
 */
export const notFoundHandler = (req, res, next) => {
  const error = new ApiError(HTTP_STATUS.NOT_FOUND, `Route ${req.originalUrl} not found`);
  next(error);
};

/**
 * Async error wrapper
 */
export const asyncErrorHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
