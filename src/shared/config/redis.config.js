// src/shared/config/redis.config.js
import dotenv from "dotenv";
import Redis from "ioredis";
import { logger } from "../services/logger.service.js";
import { createSecureRedisClient } from "../middleware/redis-security.middleware.js";

// Load environment variables
dotenv.config();

// Enhanced Redis configuration with production optimizations
const createRedisConfig = (options = {}) => {
  const isProduction = process.env.NODE_ENV === "production";
  const isDevelopment = process.env.NODE_ENV === "development";

  return {
    // Security: Disable dangerous commands in production
    ...(isProduction && {
      disableOfflineQueue: true,
      enableOfflineQueue: false,
    }),

    // Connection pool settings for high performance
    keepAlive: true,
    connectTimeout: isDevelopment ? 10000 : 5000,
    commandTimeout: isDevelopment ? 10000 : 3000,
    lazyConnect: true, // Better for production - connect when needed

    // Retry strategy with exponential backoff
    retryStrategy: (times) => {
      const maxRetries = isProduction ? 5 : 10;
      if (times > maxRetries) {
        logger.error(`Redis connection failed after ${maxRetries} retries`, {
          client: options.keyPrefix || "default",
          environment: process.env.NODE_ENV,
        });
        return null; // Stop retrying
      }

      // Exponential backoff with jitter
      const baseDelay = Math.min(times * 200, 3000);
      const jitter = Math.random() * 100; // Add randomness to prevent thundering herd
      return baseDelay + jitter;
    },

    // Request settings
    maxRetriesPerRequest: isProduction ? 2 : 3,
    enableReadyCheck: true,
    maxLoadingTimeout: 5000,

    // Error handling
    showFriendlyErrorStack: !isProduction,

    // Reconnection strategy
    reconnectOnError: (err) => {
      const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"];
      const shouldReconnect = targetErrors.some((error) => err.message.toUpperCase().includes(error));

      if (shouldReconnect) {
        logger.warn(`Redis reconnecting due to error: ${err.message}`, {
          client: options.keyPrefix || "default",
        });
      }

      return shouldReconnect;
    },

    // Production optimizations
    enableAutoPipelining: isProduction, // Automatic command batching

    // Override with custom options
    ...options,
  };
};

// Enhanced Redis client factory with health monitoring
export const createRedisClient = (options = {}) => {
  const clientId = options.keyPrefix || "default";
  const config = createRedisConfig(options);

  // Create Redis client using REDIS_URL
  const client = new Redis(process.env.REDIS_URL, config);

  // Enhanced event handling with structured logging
  client.on("error", (err) => {
    logger.error(`Redis error (${clientId})`, {
      error: err.message,
      code: err.code,
      command: err.command?.name,
      timestamp: new Date().toISOString(),
    });
  });

  client.on("connect", () => {
    logger.info(`Redis client created for ${clientId}`);
  });

  client.on("ready", () => {
    logger.info(`Redis client initialized for ${clientId}`, {
      keyPrefix: options.keyPrefix,
    });
  });

  client.on("reconnecting", (ms) => {
    logger.warn(`Redis reconnecting (${clientId})`, {
      delay: `${ms}ms`,
      attempt: "retry",
    });
  });

  client.on("end", () => {
    logger.warn(`Redis connection closed (${clientId})`, {
      status: "disconnected",
    });
  });

  client.on("close", () => {
    logger.warn(`Redis connection closed (${clientId})`, {
      reason: "connection_terminated",
    });
  });

  // Add health check method
  client.healthCheck = async () => {
    try {
      const start = Date.now();
      await client.ping();
      const latency = Date.now() - start;

      return {
        status: "healthy",
        latency: `${latency}ms`,
        client: clientId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
        client: clientId,
        timestamp: new Date().toISOString(),
      };
    }
  };

  // Add graceful disconnect method
  client.gracefulDisconnect = async () => {
    try {
      if (client.status === "ready") {
        logger.info(`Gracefully disconnecting Redis client (${clientId})`);
        await client.quit();
      } else {
        client.disconnect();
      }
    } catch (error) {
      logger.error(`Error during graceful disconnect (${clientId})`, error);
      try {
        client.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  };

  // Apply security middleware in production
  const secureClient = createSecureRedisClient(client, clientId);

  return secureClient;
};

// Client instance management with lazy initialization
class RedisClientManager {
  constructor() {
    this.clients = new Map();
    this.isShuttingDown = false;
  }

  getClient(type, options = {}) {
    if (this.isShuttingDown) {
      throw new Error("Redis client manager is shutting down");
    }

    if (!this.clients.has(type)) {
      const clientOptions = {
        keyPrefix: `${type}:`,
        ...options,
      };

      const client = createRedisClient(clientOptions);
      client.on("ready", () => {
        connectedClients.add(type);
        logUnifiedConnectionStatus();
      });
      this.clients.set(type, client);

      // Silent initialization in development
      if (process.env.NODE_ENV === "production") {
        logger.info(`Redis client initialized for ${type}`, {
          keyPrefix: clientOptions.keyPrefix,
          environment: process.env.NODE_ENV,
        });
      }
    }

    return this.clients.get(type);
  }

  async healthCheck() {
    const results = {};

    for (const [type, client] of this.clients.entries()) {
      results[type] = await client.healthCheck();
    }

    return results;
  }

  async gracefulShutdown() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info("Starting Redis clients graceful shutdown");

    const shutdownPromises = Array.from(this.clients.entries()).map(async ([type, client]) => {
      try {
        await client.gracefulDisconnect();
        logger.info(`Redis client ${type} shutdown completed`);
      } catch (error) {
        logger.error(`Error shutting down Redis client ${type}`, error);
      }
    });

    await Promise.allSettled(shutdownPromises);
    this.clients.clear();
    logger.info("All Redis clients shutdown completed");
  }
}

// Global client manager instance
const clientManager = new RedisClientManager();

// Connection status tracker to prevent duplicate messages
let connectionStatusLogged = false;
const connectedClients = new Set();

const logUnifiedConnectionStatus = () => {
  if (!connectionStatusLogged && connectedClients.size === 3) {
    console.log("✅ Redis Connected Successfully");
    connectionStatusLogged = true;
  }
};

// Exported client getters with lazy initialization
export const redisClient = () => clientManager.getClient("default");

export const rateLimitRedis = clientManager.getClient("rate-limit", {
  // Optimized for rate limiting - faster timeouts
  commandTimeout: 1000,
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
});

export const cacheRedis = clientManager.getClient("cache", {
  // Optimized for caching - allow longer timeouts for large data
  commandTimeout: 5000,
});

export const sessionRedis = clientManager.getClient("session", {
  // Optimized for sessions - reliable storage
  commandTimeout: 3000,
  maxRetriesPerRequest: 3,
});

// Health check endpoint helper
export const getRedisHealth = async () => {
  return await clientManager.healthCheck();
};

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down Redis clients...`);
  await clientManager.gracefulShutdown();
  process.exit(0);
};

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  logger.error("Uncaught Exception, shutting down Redis clients", error);
  await clientManager.gracefulShutdown();
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  logger.error("Unhandled Rejection, shutting down Redis clients", { reason, promise });
  await clientManager.gracefulShutdown();
  process.exit(1);
});

// Export configuration for testing
export { createRedisConfig };
export default clientManager;
