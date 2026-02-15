// src/modules/admin/services/cache.service.js

export class CacheService {
  constructor() {
    this.client = null;
    this.mockCache = new Map();
    this.redisInitialized = false;

    // Initialize Redis asynchronously
    this.initRedis();
  }

  async initRedis() {
    try {
      const { cacheRedis } = await import("../../../shared/config/redis.config.js");
      this.client = cacheRedis;
      this.redisInitialized = true;
    } catch (error) {
      console.warn("Redis initialization failed, using in-memory cache:", error.message);
      this.client = null;
    }
  }

  async get(key) {
    try {
      if (this.client) {
        const result = await this.client.get(key);
        return result ? JSON.parse(result) : null;
      }
      return this.mockCache.get(key) || null;
    } catch (error) {
      console.error("Cache get error:", error.message);
      return null;
    }
  }

  async setex(key, ttl, value) {
    try {
      const serializedValue = JSON.stringify(value);

      if (this.client) {
        await this.client.setex(key, ttl, serializedValue);
      } else {
        this.mockCache.set(key, value);
        setTimeout(() => this.mockCache.delete(key), ttl * 1000);
      }
    } catch (error) {
      console.error("Cache set error:", error.message);
    }
  }

  async del(...keys) {
    try {
      if (this.client) {
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } else {
        keys.forEach((key) => this.mockCache.delete(key));
      }
    } catch (error) {
      console.error("Cache delete error:", error.message);
    }
  }

  async keys(pattern) {
    try {
      if (this.client) {
        return await this.client.keys(pattern);
      }
      return Array.from(this.mockCache.keys()).filter((key) => key.includes(pattern.replace("*", "")));
    } catch (error) {
      console.error("Cache keys error:", error.message);
      return [];
    }
  }

  async invalidatePattern(pattern) {
    try {
      const keys = await this.keys(pattern);
      if (keys.length > 0) {
        await this.del(...keys);
      }
      return keys.length;
    } catch (error) {
      console.error("Cache invalidation error:", error.message);
      return 0;
    }
  }

  async invalidateUserCaches(userId = null) {
    const patterns = ["admin:users:list:*", "admin:users:search:*", "admin:stats:*"];

    if (userId) {
      patterns.push(`admin:user:${userId}`);
    }

    let totalInvalidated = 0;
    for (const pattern of patterns) {
      const count = await this.invalidatePattern(pattern);
      totalInvalidated += count;
    }

    return totalInvalidated;
  }

  generateCacheKey(prefix, data) {
    // Create deterministic cache key from object
    const sortedKeys = Object.keys(data).sort();
    const sortedData = {};
    sortedKeys.forEach((key) => {
      sortedData[key] = data[key];
    });

    const dataString = JSON.stringify(sortedData);
    const hash = this.hashString(dataString);
    return `${prefix}:${hash}`;
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

// ============================================================================
// src/modules/admin/services/validation.service.js
// ============================================================================

import mongoose from "mongoose";
import { ApiError } from "../../../shared/utils/ApiError.js";

export class ValidationService {
  validateObjectId(id, fieldName = "ID") {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, `Invalid ${fieldName}: ${id}`);
    }
  }

  validatePagination(page, limit) {
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 10));

    if (parsedPage > 10000) {
      throw new ApiError(400, "Page number too large (max: 10000)");
    }

    return { page: parsedPage, limit: parsedLimit };
  }

  validateSortParams(sortBy, sortOrder, allowedFields) {
    const validSortBy = allowedFields.includes(sortBy) ? sortBy : "createdAt";
    const validSortOrder = sortOrder === "asc" ? 1 : -1;
    return { [validSortBy]: validSortOrder };
  }

  validateUserFilters(query) {
    const filters = {};
    const { search, role, isActive, isVerified, dateFrom, dateTo, createdBefore, createdAfter } = query;

    // Search validation
    if (search) {
      const sanitizedSearch = this.sanitizeSearchQuery(search);
      if (sanitizedSearch) {
        filters.search = sanitizedSearch;
      }
    }

    // Role validation
    if (role) {
      const validRoles = ["user", "admin", "moderator"];
      if (validRoles.includes(role.toLowerCase())) {
        filters.role = role.toLowerCase();
      }
    }

    // Boolean filters
    if (isActive !== undefined) {
      filters.isActive = isActive === "true";
    }

    if (isVerified !== undefined) {
      filters.isVerified = isVerified === "true";
    }

    // Date range validation
    if (dateFrom || dateTo || createdBefore || createdAfter) {
      const dateFilter = {};

      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        if (!isNaN(fromDate.getTime())) {
          dateFilter.$gte = fromDate;
        }
      }

      if (dateTo) {
        const toDate = new Date(dateTo);
        if (!isNaN(toDate.getTime())) {
          dateFilter.$lte = toDate;
        }
      }

      if (createdBefore) {
        const beforeDate = new Date(createdBefore);
        if (!isNaN(beforeDate.getTime())) {
          dateFilter.$lt = beforeDate;
        }
      }

      if (createdAfter) {
        const afterDate = new Date(createdAfter);
        if (!isNaN(afterDate.getTime())) {
          dateFilter.$gt = afterDate;
        }
      }

      if (Object.keys(dateFilter).length > 0) {
        filters.createdAt = dateFilter;
      }
    }

    return filters;
  }

  sanitizeSearchQuery(search) {
    if (!search || typeof search !== "string") {
      return null;
    }

    // Remove potentially dangerous characters
    const sanitized = search
      .trim()
      .replace(/[<>{}()\[\]]/g, "") // Remove brackets and angle brackets
      .replace(/[*+?^$|\\]/g, "") // Remove regex special characters
      .slice(0, 100); // Limit length

    return sanitized.length >= 2 ? sanitized : null;
  }

  validateUserUpdates(updates) {
    const allowedFields = ["firstName", "lastName", "email", "role", "isActive", "isVerified", "username"];

    const forbiddenFields = ["password", "refreshToken", "_id", "__v", "createdAt", "tokenVersion"];

    const sanitizedUpdates = {};

    // Check for forbidden fields
    const forbiddenFound = Object.keys(updates).filter((key) => forbiddenFields.includes(key));

    if (forbiddenFound.length > 0) {
      throw new ApiError(400, `Cannot update forbidden fields: ${forbiddenFound.join(", ")}`);
    }

    // Validate and sanitize allowed fields
    Object.keys(updates).forEach((key) => {
      if (allowedFields.includes(key)) {
        const value = updates[key];

        switch (key) {
          case "email":
            if (value && !this.isValidEmail(value)) {
              throw new ApiError(400, "Invalid email format");
            }
            sanitizedUpdates[key] = value?.toLowerCase()?.trim();
            break;

          case "username":
            if (value && !this.isValidUsername(value)) {
              throw new ApiError(400, "Invalid username format");
            }
            sanitizedUpdates[key] = value?.toLowerCase()?.trim();
            break;

          case "role":
            const validRoles = ["user", "admin", "moderator"];
            if (value && !validRoles.includes(value.toLowerCase())) {
              throw new ApiError(400, `Invalid role. Must be one of: ${validRoles.join(", ")}`);
            }
            sanitizedUpdates[key] = value?.toLowerCase();
            break;

          case "isActive":
          case "isVerified":
            sanitizedUpdates[key] = Boolean(value);
            break;

          case "firstName":
          case "lastName":
            sanitizedUpdates[key] = typeof value === "string" ? value.trim().slice(0, 50) : value;
            break;

          default:
            sanitizedUpdates[key] = value;
        }
      }
    });

    return sanitizedUpdates;
  }

  trackUserChanges(currentUser, updates) {
    const changes = {};

    Object.keys(updates).forEach((key) => {
      if (currentUser[key] !== updates[key]) {
        changes[key] = {
          from: currentUser[key],
          to: updates[key],
        };
      }
    });

    return changes;
  }

  parseDuration(duration) {
    // Parse duration strings like "7d", "24h", "30m"
    const match = duration.match(/^(\d+)([dhm])$/);
    if (!match) {
      throw new ApiError(400, 'Invalid duration format. Use format like "7d", "24h", "30m"');
    }

    const [, amount, unit] = match;
    const multipliers = {
      m: 60 * 1000, // minutes
      h: 60 * 60 * 1000, // hours
      d: 24 * 60 * 60 * 1000, // days
    };

    return parseInt(amount) * multipliers[unit];
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  isValidUsername(username) {
    // Username should be 3-30 characters, alphanumeric with underscores/hyphens
    const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
    return usernameRegex.test(username);
  }
}
