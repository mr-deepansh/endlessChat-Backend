// src/config/index.js
import dotenv from "dotenv";
import winston from "winston";

// Store PM2/CLI environment before loading .env
const cliNodeEnv = process.env.NODE_ENV;

// Load environment variables from .env file
dotenv.config();

// CLI/PM2 environment takes priority over .env file
if (cliNodeEnv) {
  process.env.NODE_ENV = cliNodeEnv;
}

// ==========================
// LOGGER CONFIGURATION
// ==========================
const isDev = process.env.NODE_ENV === "development";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  format: isDev
    ? winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        }),
      )
    : winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
  silent: false,
});

// ==========================
// Helper Functions
// ==========================
export const parseArray = (str, defaultValue = []) => {
  if (!str) {
    return defaultValue;
  }
  return str
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const parseBoolean = (str, defaultValue = false) => {
  if (str === undefined || str === null) {
    return defaultValue;
  }
  return str.toLowerCase() === "true";
};

export const parseIntEnv = (str, defaultValue = 0) => {
  const val = parseInt(str, 10);
  return isNaN(val) ? defaultValue : val;
};

export const parseFloatEnv = (str, defaultValue = 0.0) => {
  const val = parseFloat(str);
  return isNaN(val) ? defaultValue : val;
};

// ==========================
// SERVER CONFIGURATION
// ==========================
export const serverConfig = {
  port: parseIntEnv(process.env.PORT, 5000),
  host: process.env.HOST || "localhost",
  get nodeEnv() {
    return (process.env.NODE_ENV || "development").trim();
  },
  apiVersion: process.env.API_VERSION,
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT}`,
  frontendUrl: process.env.FRONTEND_URL,
  bodyLimit: process.env.BODY_LIMIT,
  timeout: parseIntEnv(process.env.SERVER_TIMEOUT, 30000),
  keepAliveTimeout: parseIntEnv(process.env.KEEP_ALIVE_TIMEOUT, 5000),
  shutdownTimeout: parseIntEnv(process.env.SHUTDOWN_TIMEOUT, 15000),
  clustering: parseBoolean(process.env.CLUSTERING),
  backlog: parseIntEnv(process.env.BACKLOG, 511),
  httpsEnabled: parseBoolean(process.env.HTTPS_ENABLED),
  isLocalNetwork: parseBoolean(process.env.IS_LOCAL_NETWORK),
};

// ==========================
// DATABASE CONFIGURATION
// ==========================
export const databaseConfig = {
  uri: process.env.MONGODB_URI,
  dbName: process.env.DB_NAME,
  options: {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: parseIntEnv(process.env.DB_MAX_POOL_SIZE, 50),
    minPoolSize: parseIntEnv(process.env.DB_MIN_POOL_SIZE, 10),
    serverSelectionTimeoutMS: parseIntEnv(process.env.DB_TIMEOUT, 5000),
    socketTimeoutMS: parseIntEnv(process.env.DB_SOCKET_TIMEOUT, 45000),
    connectTimeoutMS: parseIntEnv(process.env.DB_CONNECT_TIMEOUT_MS, 10000),
    maxIdleTimeMS: parseIntEnv(process.env.DB_MAX_IDLE_MS, 30000),
    retryWrites: true,
    w: process.env.NODE_ENV === "production" ? "majority" : 1,
    readPreference: process.env.DB_READ_PREFERENCE,
    readConcern: { level: process.env.DB_READ_CONCERN },
    writeConcern: { w: process.env.NODE_ENV === "production" ? "majority" : 1, j: true },
    compressors: ["zstd", "zlib"],
    zlibCompressionLevel: 6,
    appName: process.env.DB_APP_NAME,
    monitorCommands: process.env.NODE_ENV !== "production",
    serverApi: { version: "1", strict: false, deprecationErrors: false },
  },
};

// ==========================
// JWT CONFIGURATION
// ==========================
export const jwtConfig = {
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  algorithm: "HS256",
  accessTokenSecret: process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET,
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET,
  accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || "15m",
  refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || "7d",
  issuer: process.env.JWT_ISSUER || "endlessChatt",
  audience: process.env.JWT_AUDIENCE || "endlessChatt-users",
};

// ==========================
// EMAIL CONFIGURATION
// ==========================
export const emailConfig = {
  service: process.env.EMAIL_SERVICE || "gmail",
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseIntEnv(process.env.EMAIL_PORT, 587),
  secure: parseBoolean(process.env.EMAIL_SECURE),
  auth: {
    user: process.env.EMAIL_USERNAME || process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS,
  },
  from: {
    email: process.env.EMAIL_FROM || process.env.EMAIL_USERNAME,
    name: process.env.EMAIL_FROM_NAME || "endlessChatt",
  },
};

// ==========================
// SECURITY CONFIGURATION
// ==========================
export const securityConfig = {
  cors: {
    origin: (origin, callback) => {
      const corsOrigin = process.env.CORS_ORIGIN;
      if (corsOrigin === "*") {
        if (serverConfig.nodeEnv === "development") {
          return callback(null, true);
        }
        return callback(new Error("CORS wildcard * not allowed in production"));
      }
      const allowedOrigins = corsOrigin ? parseArray(corsOrigin) : [];
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control",
      "X-File-Name",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    maxAge: 86400,
  },
  rateLimit: {
    windowMs: parseIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: parseIntEnv(process.env.RATE_LIMIT_MAX, 100),
    message: {
      error: "Too many requests, please try again later.",
      retryAfter: Math.ceil(parseIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000) / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
  },
  passwordReset: {
    tokenExpiry: parseIntEnv(process.env.PASSWORD_RESET_TOKEN_EXPIRY, 15),
  },
};

// ==========================
// VALIDATE REQUIRED ENV VARIABLES
// ==========================
export const validateConfig = () => {
  const required = ["MONGODB_URI", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(", ")}`);
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    logger.warn("⚠️ JWT_SECRET should be at least 32 characters long for security");
  }
  logger.info("Configuration validation passed ✅");
  return true;
};

// ==========================
// EXPORT DEFAULT CONFIG
// ==========================
export default {
  logger,
  server: serverConfig,
  database: databaseConfig,
  jwt: jwtConfig,
  email: emailConfig,
  security: securityConfig,
  parseArray,
  parseBoolean,
  parseIntEnv,
  parseFloatEnv,
  validate: validateConfig,
};
