import { ApiError } from "./ApiError.js";
import { ApiResponse } from "./ApiResponse.js";

/**
 * Global error handler for Express applications
 */
export const globalErrorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error("Error:", {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString(),
  });

  // ---- Specific Error Cases ----
  if (err.name === "CastError") {
    error = new ApiError(404, "Resource not found");
  }
  if (err.code === 11000) {
    error = new ApiError(400, "Duplicate field value entered");
  }
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((val) => val.message)
      .join(", ");
    error = new ApiError(400, message);
  }
  if (err.name === "JsonWebTokenError") {
    error = new ApiError(401, "Invalid token");
  }
  if (err.name === "TokenExpiredError") {
    error = new ApiError(401, "Token expired");
  }

  res.status(error.statusCode || 500).json(
    new ApiResponse(error.statusCode || 500, error.data || null, error.message || "Internal Server Error", false, {
      path: req.originalUrl,
      method: req.method,
    }),
  );
};

/** Async error wrapper */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 404 handler */
export const notFound = (req, res, next) => {
  const error = new ApiError(404, `Route ${req.originalUrl} not found`);
  next(error);
};

/** Validation error handler */
export const validationErrorHandler = (errors) => {
  const errorMessages = errors.map((error) => ({
    field: error.path,
    message: error.msg,
    value: error.value,
  }));
  throw new ApiError(400, "Validation failed", errorMessages);
};

/** Database error handler */
export const handleDatabaseError = (error) => {
  console.error("Database connection error:", error);
  if (error.name === "MongoNetworkError") {
    throw new ApiError(503, "Database connection failed");
  }
  if (error.name === "MongoTimeoutError") {
    throw new ApiError(408, "Database operation timeout");
  }
  throw new ApiError(500, "Database error occurred");
};

/** Safe async wrapper */
export const safeAsyncOperation = async (operation, fallback = null, throwOnError = true) => {
  try {
    return await operation();
  } catch (error) {
    console.error("Safe async operation failed:", error);
    if (throwOnError) {
      throw error;
    }
    return fallback;
  }
};

/** Controller error handler */
export const handleControllerError = (error, req, res, startTime, logger) => {
  const executionTime = Date.now() - startTime;

  logger?.error("Controller error:", {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    executionTime,
  });

  if (error instanceof ApiError) {
    return res.status(error.statusCode).json(
      new ApiResponse(error.statusCode, error.data, error.message, false, {
        path: req.originalUrl,
        method: req.method,
        executionTime: `${executionTime}ms`,
      }),
    );
  }

  return res.status(500).json(
    new ApiResponse(500, null, "Internal server error", false, {
      path: req.originalUrl,
      method: req.method,
      executionTime: `${executionTime}ms`,
    }),
  );
};
