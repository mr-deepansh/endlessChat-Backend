// Enterprise Security Configuration
import crypto from "crypto";
import { logger } from "../services/logger.service.js";

const isProduction = process.env.NODE_ENV === "production";

// Validate security environment variables
export const validateSecurityConfig = () => {
  const errors = [];

  // JWT Secret validation
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 64) {
    errors.push("JWT_SECRET must be at least 64 characters");
  }

  if (!process.env.ACCESS_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET.length < 64) {
    errors.push("ACCESS_TOKEN_SECRET must be at least 64 characters");
  }

  if (!process.env.REFRESH_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET.length < 64) {
    errors.push("REFRESH_TOKEN_SECRET must be at least 64 characters");
  }

  // Encryption key validation
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
    errors.push("ENCRYPTION_KEY must be at least 32 characters");
  }

  // Redis validation (production only)
  if (isProduction && process.env.REDIS_URL) {
    const passwordMatch = process.env.REDIS_URL.match(/redis:\/\/:([^@]+)@/);
    if (passwordMatch && passwordMatch[1] && passwordMatch[1].length < 16) {
      errors.push("REDIS_URL password must be at least 16 characters in production");
    }
  }

  // MongoDB URI validation
  if (!process.env.MONGODB_URI) {
    errors.push("MONGODB_URI is required");
  } else if (isProduction && !process.env.MONGODB_URI.includes("mongodb+srv://")) {
    logger.warn("Consider using MongoDB Atlas (mongodb+srv://) in production");
  }

  // Email password validation
  if (!process.env.EMAIL_PASSWORD) {
    errors.push("EMAIL_PASSWORD is required");
  }

  if (errors.length > 0) {
    logger.error("Security configuration validation failed", { errors });
    throw new Error(`Security validation failed: ${errors.join(", ")}`);
  }

  logger.info("✅ Security configuration validated successfully");
  return true;
};

// Generate secure random tokens
export const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString("hex");
};

// Hash sensitive data
export const hashData = (data) => {
  return crypto.createHash("sha256").update(data).digest("hex");
};

// Encrypt sensitive data
export const encryptData = (data) => {
  const algorithm = "aes-256-cbc";
  const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, "salt", 32);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");

  return `${iv.toString("hex")}:${encrypted}`;
};

// Decrypt sensitive data
export const decryptData = (encryptedData) => {
  const algorithm = "aes-256-cbc";
  const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, "salt", 32);

  const [ivHex, encrypted] = encryptedData.split(":");
  const iv = Buffer.from(ivHex, "hex");

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};

// Security headers configuration
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

// Rate limiting configuration
export const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 100 : 1000,
  message: "Too many requests from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
};

// Password policy
export const passwordPolicy = {
  minLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
  requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE === "true",
  requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE === "true",
  requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS === "true",
  requireSpecial: process.env.PASSWORD_REQUIRE_SPECIAL === "true",
  maxLength: 128,
};

// Session configuration
export const sessionConfig = {
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: "strict",
  },
};

export default {
  validateSecurityConfig,
  generateSecureToken,
  hashData,
  encryptData,
  decryptData,
  securityHeaders,
  rateLimitConfig,
  passwordPolicy,
  sessionConfig,
};
