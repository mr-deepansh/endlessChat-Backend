// src/shared/middleware/cors.middleware.js
import cors from "cors";
import { logger } from "../../config/index.js";

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.CORS_ORIGIN?.split(",") || [];
    console.log(
      `🔍 CORS Check - Origin: ${origin}, Allowed: ${allowedOrigins.join(", ")}, Env: ${process.env.NODE_ENV}`,
    );

    // Dev mode: allow specific origins for cookies
    if (process.env.NODE_ENV === "development") {
      if (!origin || allowedOrigins.includes(origin)) {
        console.log("✅ CORS Allowed - Dev mode");
        return callback(null, true);
      }
    }

    // Prod mode: specific allowed origins only
    if (!origin || allowedOrigins.includes(origin)) {
      console.log("✅ CORS Allowed - Prod mode");
      return callback(null, true);
    }

    console.log(`❌ CORS Blocked - Origin: ${origin}`);
    logger.warn(`Blocked CORS request from: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
  },

  credentials: true, // Always true for cookies
  methods: process.env.CORS_METHODS?.split(",") || ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-CSRF-Token",
    "X-Client-Version",
    "Cache-Control",
    "Accept",
  ],
  optionsSuccessStatus: parseInt(process.env.CORS_OPTIONS_SUCCESS_STATUS) || 204,
  maxAge: parseInt(process.env.CORS_MAX_AGE) || 86400,
  preflightContinue: false,
};

export { corsOptions };
export default cors(corsOptions);
