// src/config/database/connection.js
import mongoose from "mongoose";
import events from "events";
import { databaseConfig } from "../index.js";
import { Logger } from "../../shared/utils/Logger.js";

const logger = new Logger("MongoDB");

let connectionPromise = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;
let isShuttingDown = false;

// Prevent MaxListenersExceededWarning
process.setMaxListeners(50);
events.EventEmitter.defaultMaxListeners = 50;

// Apply global mongoose settings
mongoose.set("strictQuery", false);
mongoose.set("debug", process.env.NODE_ENV === "development");
mongoose.set("bufferCommands", false);
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

// Build Mongo URI
const buildMongoUri = () => {
  if (!databaseConfig.uri) {
    throw new Error("MONGODB_URI is required");
  }
  const raw = databaseConfig.uri.trim();
  const hasDb = /\/[^/?]+(.+)?$/.test(raw) && !raw.endsWith("/");
  return hasDb ? raw : `${raw.replace(/\/+$/, "")}/${databaseConfig.dbName}`;
};

// Connect function
export const connectDB = async (retryCount = 0) => {
  if (connectionPromise && mongoose.connection.readyState === 2) {
    return connectionPromise;
  }
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    const uri = buildMongoUri();
    const maskedUri = uri.replace(/:([^:@]+)@/, ":***@");
    logger.info(`Connecting to MongoDB: ${maskedUri}`);

    // remove deprecated options from config
    const { useNewUrlParser, useUnifiedTopology, ...options } = databaseConfig.options;

    connectionPromise = mongoose.connect(uri, options);
    const conn = await connectionPromise;
    reconnectAttempts = 0;

    logger.success(`✅ Connected to ${conn.connection.host}:${conn.connection.port}`, {
      db: conn.connection.name,
      readyState: conn.connection.readyState,
      poolSize: options.maxPoolSize,
    });

    return conn.connection;
  } catch (error) {
    connectionPromise = null;
    logger.error("MongoDB connection failed", {
      error: error.message,
      attempt: retryCount + 1,
    });

    if (retryCount < MAX_RECONNECT_ATTEMPTS && !isShuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY * (retryCount + 1)));
      return connectDB(retryCount + 1);
    }

    process.exit(1);
  }
};

// Disconnect function
export const disconnectDB = async (force = false) => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(force);
    connectionPromise = null;
    logger.success("MongoDB connection closed");
  }
};

// Graceful shutdown only once
if (!global.__MONGO_SHUTDOWN_HANDLER__) {
  const gracefulShutdown = async (signal) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info(`Received ${signal}, closing MongoDB connection...`);
    await disconnectDB();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  global.__MONGO_SHUTDOWN_HANDLER__ = true;
}

export default connectDB;
