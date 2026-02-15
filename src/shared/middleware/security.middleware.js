// src/shared/middleware/security.middleware.js
/**
 * Enterprise-grade security middleware
 * @version 2.0.0
 * @author Deepansh Gangwar
 */

import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../services/logger.service.js";
import { HTTP_STATUS, RATE_LIMIT, MESSAGES } from "../constants/index.js";

/**
 * Enhanced rate limiting with Redis store
 */
export const createRateLimit = (options = {}) => {
  const defaultOptions = {
    windowMs: RATE_LIMIT.WINDOW_MS,
    max: RATE_LIMIT.MAX_REQUESTS,
    message: {
      success: false,
      message: "Too many requests, please try again later",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn("Rate limit exceeded", {
        ip: req.ip,
        url: req.originalUrl,
        userAgent: req.get("User-Agent"),
      });

      res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        message: "Too many requests, please try again later",
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
    },
  };

  return rateLimit({ ...defaultOptions, ...options });
};

/**
 * Auth-specific rate limiting
 */
export const authRateLimit = createRateLimit({
  windowMs: RATE_LIMIT.AUTH_WINDOW_MS,
  max: RATE_LIMIT.AUTH_MAX_REQUESTS,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later",
  },
});

/**
 * Security headers middleware
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

/**
 * Input sanitization middleware
 */
export const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === "string") {
      return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    }
    if (typeof obj === "object" && obj !== null) {
      for (const key in obj) {
        obj[key] = sanitize(obj[key]);
      }
    }
    return obj;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);

  next();
};

/**
 * IP validation middleware
 */
export const validateIP = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;

  // Log suspicious IPs
  if (clientIP && clientIP.includes("127.0.0.1") === false && clientIP.includes("::1") === false) {
    logger.info("Request from external IP", { ip: clientIP, url: req.originalUrl });
  }

  next();
};

/**
 * Request size limiter
 */
export const requestSizeLimit = (req, res, next) => {
  const contentLength = parseInt(req.get("content-length") || "0");
  const maxSize = 16 * 1024 * 1024; // 16MB

  if (contentLength > maxSize) {
    logger.warn("Request size exceeded", {
      ip: req.ip,
      size: contentLength,
      maxSize,
      url: req.originalUrl,
    });

    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: "Request entity too large",
    });
  }

  next();
};

/**
 * Security audit logger
 */
export const securityAudit = (req, res, next) => {
  const securityContext = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
    userId: req.user?._id,
  };

  // Log sensitive operations
  const sensitiveRoutes = ["/login", "/register", "/reset-password", "/change-password"];
  if (sensitiveRoutes.some((route) => req.originalUrl.includes(route))) {
    logger.info("Security-sensitive operation", securityContext);
  }

  next();
};
