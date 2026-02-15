// src/shared/middleware/rateLimit.middleware.js
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { rateLimitRedis } from "../config/redis.config.js";
import { logger } from "../services/logger.service.js"; // Use your existing logger
import { Logger } from "../utils/Logger.js"; // Your custom logger class
import { createHash } from "crypto";

// Create a specialized logger instance for rate limiting
const rateLimitLogger = new Logger("RateLimit");

// Rate limit configuration with validation
const max =
  process.env.NODE_ENV === "development"
    ? 10000 // 10k requests per window in dev
    : Math.max(1, parseInt(process.env.RATE_LIMIT_MAX) || 100);

const windowMs =
  process.env.NODE_ENV === "development"
    ? 60 * 1000 // 1 minute window in dev
    : Math.max(1000, parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000);

// Use centralized Redis client for rate limiting
let redis;
let redisHealthy = false;

// Initialize Redis client with error handling
try {
  redis = rateLimitRedis();
  if (redis) {
    redisHealthy = true;
    rateLimitLogger.info("Redis client initialized for rate limiting");
  }
} catch (error) {
  rateLimitLogger.error("Failed to initialize Redis client for rate limiting", { error: error.message });
  redis = null;
  redisHealthy = false;
}

// Handle Redis connection errors with fallback
if (redis) {
  redis.on("error", (err) => {
    redisHealthy = false;
    rateLimitLogger.warn("Redis connection error for rate limiting", { error: err.message });
  });

  redis.on("connect", () => {
    redisHealthy = true;
    rateLimitLogger.info("Redis connected for rate limiting");
  });

  redis.on("ready", () => {
    redisHealthy = true;
    rateLimitLogger.info("Redis ready for rate limiting");
  });

  redis.on("end", () => {
    redisHealthy = false;
    rateLimitLogger.warn("Redis connection ended for rate limiting");
  });
} else {
  rateLimitLogger.warn("Redis client not available, using memory store for rate limiting");
}

// Create store with fallback
const createStore = () => {
  if (redis && redisHealthy) {
    try {
      return new RedisStore({
        sendCommand: (...args) => redis.call(...args),
        prefix: "rl:",
      });
    } catch (error) {
      rateLimitLogger.warn("Failed to create Redis store, using memory fallback", { error: error.message });
      return undefined; // Use built-in memory store
    }
  }

  rateLimitLogger.info("Using built-in memory store for rate limiting");
  return undefined; // Use built-in memory store
};

// Enhanced key generation for better security
const keyGenerator = (req) => {
  // Prioritize authenticated users
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }

  // Use session if available
  if (req.session?.id) {
    return `session:${req.session.id}`;
  }

  // Hash IP for privacy while maintaining uniqueness
  const ip =
    req.ip ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "unknown";

  const hashedIP = createHash("sha256").update(`${ip}rate_limit_salt`).digest("hex").substring(0, 16);

  return `ip:${hashedIP}`;
};

// Enhanced skip logic
const skipRequest = (req) => {
  // Always skip in development
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  // Skip health checks and static files
  const skipPaths = ["/health", "/healthz", "/ping", "/metrics", "/api/v2", "/favicon.ico"];
  if (skipPaths.includes(req.path)) {
    return true;
  }

  // Skip static assets
  if (/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|webp|mp4)$/i.test(req.path)) {
    return true;
  }

  // Skip static directories
  if (/^\/(static|assets|public|uploads)\//i.test(req.path)) {
    return true;
  }

  // Skip internal requests
  if (req.headers["x-internal-request"] === "true") {
    return true;
  }

  // Skip admin users
  if (req.user?.role === "admin" || req.user?.isAdmin) {
    return true;
  }

  return false;
};

// Enhanced message with better UX
const createMessage = (req, res) => {
  const remaining = res.getHeader("X-RateLimit-Remaining") || 0;
  const resetTime = res.getHeader("X-RateLimit-Reset");
  const retryAfter = resetTime ? Math.ceil(resetTime - Date.now() / 1000) : Math.ceil(windowMs / 1000);

  return {
    statusCode: 429,
    success: false,
    error: "RATE_LIMIT_EXCEEDED",
    message: process.env.RATE_LIMIT_MESSAGE || "Too many requests. Please slow down.",
    details: {
      limit: max,
      remaining: Math.max(0, remaining),
      retryAfter: Math.max(1, retryAfter),
      resetTime: resetTime ? new Date(resetTime * 1000).toISOString() : null,
      windowMs,
      type: "general_rate_limit",
    },
    suggestions: [
      "Wait before making more requests",
      "Implement request caching on your client",
      "Contact support if you need higher limits",
    ],
  };
};

// Rate limit monitoring function (for express-rate-limit v7 compatibility)
const logRateLimitExceeded = (req, res) => {
  const logData = {
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    path: req.path,
    method: req.method,
    userId: req.user?.id || "anonymous",
    remaining: res.getHeader("X-RateLimit-Remaining") || 0,
    limit: max,
    windowMs,
  };

  rateLimitLogger.warn("Rate limit exceeded", logData);

  // Enhanced abuse detection
  const userAgent = req.get("User-Agent") || "";
  const suspiciousPatterns = /bot|crawler|spider|scan|hack|curl|wget|postman|automated/i;

  if (suspiciousPatterns.test(userAgent)) {
    rateLimitLogger.error("Suspicious activity detected", {
      ...logData,
      pattern: "bot_activity",
      severity: "medium",
    });
  }

  // Check for rapid API requests from unauthenticated users
  if (!req.user?.id && req.path.includes("/api/")) {
    rateLimitLogger.error("Potential API abuse detected", {
      ...logData,
      pattern: "rapid_api_requests",
      severity: "high",
    });
  }
};

// Enhanced error handler (updated for express-rate-limit v7)
const rateLimitHandler = (req, res, next, options) => {
  // Log the rate limit hit (replaces deprecated onLimitReached)
  logRateLimitExceeded(req, res);

  // Add comprehensive security headers
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "X-Rate-Limit-Type": "general",
    "Retry-After": res.getHeader("X-RateLimit-Reset") || Math.ceil(windowMs / 1000),
  });

  res.status(429).json(options.message(req, res));
};

// Create the main rate limiter (updated for express-rate-limit v7)
export const apiRateLimiter = rateLimit({
  store: createStore(),
  windowMs,
  max,
  message: createMessage,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator,
  skip: skipRequest,
  handler: rateLimitHandler,

  // Additional configuration
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
  requestWasSuccessful: (req, res) => res.statusCode < 400,
  requestPropertyName: "rateLimit",
});

// Strict rate limiter for authentication endpoints
export const authRateLimiter = rateLimit({
  store: createStore(),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "development" ? 1000 : 5, // Very strict

  message: (req, res) => ({
    statusCode: 429,
    success: false,
    error: "AUTH_RATE_LIMIT_EXCEEDED",
    message: "Too many authentication attempts. Please wait before trying again.",
    details: {
      retryAfter: 900, // 15 minutes
      limit: 5,
      remaining: res.getHeader("X-RateLimit-Remaining") || 0,
      type: "authentication_rate_limit",
    },
    suggestions: [
      "Double-check your credentials",
      "Use password reset if you've forgotten your password",
      "Contact support if you're locked out",
    ],
  }),

  standardHeaders: "draft-7",
  legacyHeaders: false,

  keyGenerator: (req) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const identifier = req.body?.email || req.body?.username || req.body?.phone || "unknown";

    return `auth:${createHash("sha256").update(`${ip}:${identifier}:auth_salt`).digest("hex").substring(0, 20)}`;
  },

  skip: (req) => process.env.NODE_ENV === "development",

  handler: (req, res, next, options) => {
    const logData = {
      ip: req.ip,
      identifier: req.body?.email || req.body?.username || "unknown",
      userAgent: req.get("User-Agent"),
      timestamp: new Date().toISOString(),
      severity: "critical",
    };

    rateLimitLogger.error("Authentication rate limit exceeded", logData);

    // Add security headers
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Retry-After": "900",
    });

    res.status(429).json(options.message(req, res));
  },
});

// Export configuration for monitoring
export const rateLimitConfig = {
  max,
  windowMs,
  environment: process.env.NODE_ENV,
  redisHealthy: () => redisHealthy,
  isEnabled: process.env.NODE_ENV !== "development",
};

// Graceful shutdown
const gracefulShutdown = () => {
  rateLimitLogger.info("Shutting down rate limiting system...");
  if (redis && typeof redis.quit === "function") {
    redis.quit(() => {
      rateLimitLogger.info("Redis connection closed for rate limiting");
    });
  }
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Log initialization
rateLimitLogger.success("Rate limiting middleware initialized", {
  environment: process.env.NODE_ENV,
  maxRequests: max,
  windowMs,
  rateLimitingEnabled: process.env.NODE_ENV !== "development",
  redisEnabled: redisHealthy,
});
