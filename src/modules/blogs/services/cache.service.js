// src/modules/blogs/services/cache.service.js
import { cacheRedis } from "../../../shared/config/redis.config.js";
import { Logger } from "../../../shared/utils/Logger.js";

const logger = new Logger("CacheService");

class CacheService {
  constructor() {
    this.redis = cacheRedis;

    this.keyPrefix = "blog:";
    this.defaultTTL = 3600;

    this.redis.on("error", (error) => {
      logger.error("Redis error:", error);
    });
  }

  async get(key) {
    try {
      const data = await this.redis.get(`${this.keyPrefix}${key}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error("Cache get error:", error);
      return null;
    }
  }

  async set(key, data, ttl = this.defaultTTL) {
    try {
      await this.redis.setex(`${this.keyPrefix}${key}`, ttl, JSON.stringify(data));
    } catch (error) {
      logger.error("Cache set error:", error);
    }
  }

  async del(key) {
    try {
      await this.redis.del(`${this.keyPrefix}${key}`);
    } catch (error) {
      logger.error("Cache delete error:", error);
    }
  }

  async invalidatePattern(pattern) {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}${pattern}`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      logger.error("Cache invalidation error:", error);
    }
  }
}

export default new CacheService();
