// src/config/redis/redis.optimized.js
import Redis from "ioredis";

class RedisManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.connectionPromise = null;
    this.init();
  }

  init() {
    const config = {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
      db: process.env.REDIS_DB || 0,
      connectTimeout: 5000,
      commandTimeout: 3000,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      lazyConnect: false,
      family: 4,
      keepAlive: true,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 50, 1000)),
    };

    this.client = new Redis(config);
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on("connect", () => {
      this.isConnected = true;
    });

    this.client.on("ready", () => {
      console.log("✅ Redis Connected Successfully");
      this.isConnected = true;
    });

    this.client.on("error", (err) => {
      console.error("Redis error:", err.message);
      this.isConnected = false;
    });

    this.client.on("close", () => {
      this.isConnected = false;
    });
  }

  async safeOperation(operation, fallback = null) {
    if (!this.isConnected || this.client.status !== "ready") {
      return fallback;
    }

    try {
      return await operation();
    } catch (error) {
      console.error("Redis operation failed:", error.message);
      return fallback;
    }
  }

  async get(key) {
    return this.safeOperation(async () => {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    });
  }

  async set(key, value, ttl = 3600) {
    return this.safeOperation(async () => {
      const serialized = JSON.stringify(value);
      return ttl ? await this.client.setex(key, ttl, serialized) : await this.client.set(key, serialized);
    });
  }

  async del(key) {
    return this.safeOperation(async () => await this.client.del(key));
  }

  async exists(key) {
    return this.safeOperation(async () => await this.client.exists(key), false);
  }

  async incr(key, ttl = 3600) {
    return this.safeOperation(async () => {
      const result = await this.client.incr(key);
      if (result === 1 && ttl) {
        await this.client.expire(key, ttl);
      }
      return result;
    });
  }

  getStatus() {
    return {
      connected: this.isConnected,
      status: this.client?.status || "disconnected",
    };
  }
}

export const redisManager = new RedisManager();
export const redisClient = redisManager.client;
