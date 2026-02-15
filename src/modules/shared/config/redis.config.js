// src/shared/config/redis.config.js
import Redis from "ioredis";
import { Logger } from "../../../shared/utils/Logger.js";
const logger = new Logger("Redis");

/**
 * Redis configuration with clustering and failover support
 */
const redisConfig = {
  // Single Redis instance config
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
  db: process.env.REDIS_DB || 0,

  // Connection options
  connectTimeout: 10000,
  commandTimeout: 5000,
  retryDelayOnFailover: 100,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,

  // Cluster configuration (if using Redis Cluster)
  enableOfflineQueue: false,
  lazyConnect: true,

  // Connection pool
  family: 4,
  keepAlive: true,

  // Reconnection strategy
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    logger.info(`Attempting Redis reconnection ${times}, delay: ${delay}ms`);
    return delay;
  },
};

/**
 * Initialize Redis client with error handling
 */
let redisClient;

try {
  if (process.env.REDIS_CLUSTER_ENABLED === "true") {
    // Redis Cluster configuration
    const clusterNodes = process.env.REDIS_CLUSTER_NODES
      ? JSON.parse(process.env.REDIS_CLUSTER_NODES)
      : [{ host: "localhost", port: 6379 }];
    redisClient = new Redis.Cluster(clusterNodes, {
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        connectTimeout: 10000,
        commandTimeout: 5000,
      },
      enableOfflineQueue: false,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });
  } else {
    // Single Redis instance
    redisClient = new Redis(redisConfig);
  }
  // Event handlers
  redisClient.on("connect", () => {
    logger.info("Redis client connected");
  });
  redisClient.on("ready", () => {
    logger.info("Redis client ready");
  });
  redisClient.on("error", (err) => {
    logger.error("Redis client error:", err);
  });
  redisClient.on("close", () => {
    logger.warn("Redis client connection closed");
  });
  redisClient.on("reconnecting", () => {
    logger.info("Redis client reconnecting");
  });
  // Graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Closing Redis connection...");
    await redisClient.quit();
  });
  process.on("SIGTERM", async () => {
    logger.info("Closing Redis connection...");
    await redisClient.quit();
  });
} catch (error) {
  logger.error("Failed to initialize Redis client:", error);
  process.exit(1);
}

/**
 * Redis utility functions for enterprise operations
 */
const RedisUtils = {
  /**
   * Set data with TTL
   */
  async setWithTTL(key, value, ttlSeconds = 3600) {
    try {
      const serializedValue = typeof value === "object" ? JSON.stringify(value) : value;
      return await redisClient.setex(key, ttlSeconds, serializedValue);
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      throw error;
    }
  },
  /**
   * Get data with automatic JSON parsing
   */
  async get(key) {
    try {
      const value = await redisClient.get(key);
      if (!value) {
        return null;
      }
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  },
  /**
   * Delete keys by pattern
   */
  async deletePattern(pattern) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        return await redisClient.del(...keys);
      }
      return 0;
    } catch (error) {
      logger.error(`Redis DELETE pattern error for ${pattern}:`, error);
      throw error;
    }
  },
  /**
   * Get Redis connection status
   */
  getConnectionStatus() {
    return {
      status: redisClient.status,
      connected: redisClient.status === "ready",
      clusterMode: process.env.REDIS_CLUSTER_ENABLED === "true",
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  },
};

export { redisClient, RedisUtils };
