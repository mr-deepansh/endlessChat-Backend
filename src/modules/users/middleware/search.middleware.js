// src/shared/middleware/search.middleware.js
import rateLimit from "express-rate-limit";
import { ApiError } from "../utils/ApiError.js";

// In-memory cache for search results
class SearchCache {
  constructor(ttl = 5 * 60 * 1000, maxSize = 1000) {
    this.cache = new Map();
    this.ttl = ttl;
    this.maxSize = maxSize;
    this.hits = 0;
    this.misses = 0;

    // Clean cache every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  generateKey(userId, query, filters = {}) {
    const keyData = {
      userId: userId?.toString(),
      ...query,
      ...filters,
    };

    // Sort keys for consistent cache keys
    const sortedKeys = Object.keys(keyData).sort();
    const keyString = sortedKeys.map((key) => `${key}:${keyData[key]}`).join("|");

    return Buffer.from(keyString).toString("base64").slice(0, 64);
  }

  get(key) {
    const item = this.cache.get(key);

    if (!item) {
      this.misses++;
      return null;
    }

    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    item.accessCount = (item.accessCount || 0) + 1;
    item.lastAccessed = Date.now();

    return item.data;
  }

  set(key, data) {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
    });
  }

  evictLRU() {
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, value] of this.cache.entries()) {
      if (value.lastAccessed < oldestTime) {
        oldestTime = value.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));

    console.log(`Cache cleanup: removed ${keysToDelete.length} expired items`);
  }

  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses) || 0,
      maxSize: this.maxSize,
    };
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// Create global cache instance
const searchCache = new SearchCache();

// Rate limiting configurations
export const searchRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 search requests per window
  message: {
    error: "Too many search requests",
    message: "Please wait before making more search requests",
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for admins
    return req.user?.role === "admin";
  },
  keyGenerator: (req) => {
    // Use user ID if available, otherwise IP
    return req.user?._id?.toString() || req.ip;
  },
});

// Aggressive rate limiting for search suggestions
export const searchSuggestionsRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    error: "Too many suggestion requests",
    message: "Please slow down your typing",
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin-only rate limiting for analytics
export const searchAnalyticsRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // 100 analytics requests per hour
  message: {
    error: "Analytics rate limit exceeded",
    message: "Too many analytics requests",
    retryAfter: 60 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Cache middleware
export const searchCacheMiddleware = (req, res, next) => {
  // Skip caching for admin users or if explicitly disabled
  if (req.user?.role === "admin" || req.query.noCache === "true") {
    return next();
  }

  const cacheKey = searchCache.generateKey(req.user?._id, req.query);
  const cachedResult = searchCache.get(cacheKey);

  if (cachedResult) {
    // Add cache headers
    res.set({
      "X-Cache": "HIT",
      "X-Cache-Key": `${cacheKey.slice(0, 16)}...`,
    });

    return res.status(200).json({
      ...cachedResult,
      meta: {
        ...cachedResult.meta,
        cached: true,
        cacheKey: `${cacheKey.slice(0, 16)}...`,
      },
    });
  }

  // Store cache key and original json method
  req.cacheKey = cacheKey;
  const originalJson = res.json.bind(res);

  // Override res.json to cache successful responses
  res.json = function (data) {
    // Only cache successful search responses
    if (res.statusCode === 200 && data.success !== false) {
      searchCache.set(cacheKey, data);

      // Add cache headers
      res.set({
        "X-Cache": "MISS",
        "X-Cache-Key": `${cacheKey.slice(0, 16)}...`,
      });
    }

    return originalJson(data);
  };

  next();
};

// Search analytics middleware
export const searchAnalyticsMiddleware = (req, res, next) => {
  // Skip analytics for admin users if desired
  if (req.user?.role === "admin" && req.query.skipAnalytics === "true") {
    return next();
  }

  // Store search analytics data
  const searchData = {
    userId: req.user?._id,
    userRole: req.user?.role,
    searchTerm: req.query.search || req.query.q,
    searchType: req.route?.path?.includes("advanced") ? "advanced" : "basic",
    filters: {
      sortBy: req.query.sortBy,
      includePrivate: req.query.includePrivate,
      includeInactive: req.query.includeInactive,
    },
    timestamp: new Date(),
    ip: req.ip,
    userAgent: req.get("User-Agent"),
  };

  // Store in request for potential use in controller
  req.searchAnalytics = searchData;

  // Override res.json to capture results
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    // Add result analytics
    if (data.data?.pagination) {
      req.searchAnalytics.resultCount = data.data.pagination.totalResults;
      req.searchAnalytics.resultTime = data.data.meta?.searchTime;
    }

    // TODO: Here you would typically save to analytics database
    // await AnalyticsService.recordSearch(req.searchAnalytics);

    return originalJson(data);
  };

  next();
};

// Search security middleware
export const searchSecurityMiddleware = (req, res, next) => {
  const { search, q } = req.query;
  const searchTerm = search || q;

  if (searchTerm) {
    // Check for potential security threats
    const securityPatterns = [
      // SQL injection patterns
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
      // NoSQL injection patterns
      /(\$where|\$regex|\$ne|\$gt|\$lt|\$in|\$nin)/gi,
      // Script injection
      /<script[^>]*>.*?<\/script>/gi,
      // Potential XSS
      /(javascript:|data:|vbscript:)/gi,
      // File path traversal
      /(\.\.|\/\.\.|\\\.\.)/g,
      // Command injection
      /(\||&&|;|\$\(|\`)/g,
    ];

    for (const pattern of securityPatterns) {
      if (pattern.test(searchTerm)) {
        throw new ApiError(400, "Invalid search term detected");
      }
    }

    // Check search term length and complexity
    if (searchTerm.length > 200) {
      throw new ApiError(400, "Search term too long");
    }

    // Check for repetitive patterns (potential DoS)
    const uniqueChars = new Set(searchTerm.toLowerCase()).size;
    if (searchTerm.length > 10 && uniqueChars < 3) {
      throw new ApiError(400, "Invalid search pattern");
    }
  }

  next();
};

// Permission middleware for advanced search
export const advancedSearchPermission = (req, res, next) => {
  const userRole = req.user?.role;
  const { includePrivate, includeInactive, role } = req.query;

  // Only admins can search private profiles
  if (includePrivate === "true" && userRole !== "admin") {
    throw new ApiError(403, "Insufficient permissions to search private profiles");
  }

  // Only admins can search inactive users
  if (includeInactive === "true" && userRole !== "admin") {
    throw new ApiError(403, "Insufficient permissions to search inactive users");
  }

  // Only admins can filter by role
  if (role && userRole !== "admin") {
    throw new ApiError(403, "Insufficient permissions to filter by role");
  }

  next();
};

// Search logging middleware
export const searchLoggingMiddleware = (req, res, next) => {
  const startTime = Date.now();

  // Log search attempt

  const originalJson = res.json.bind(res);
  res.json = function (data) {
    const duration = Date.now() - startTime;
    const resultCount = data.data?.pagination?.totalResults || 0;

    return originalJson(data);
  };

  next();
};

// Export cache instance for use in controllers
export { searchCache };

// Export middleware combination for common use cases
export const basicSearchMiddleware = [
  searchSecurityMiddleware,
  searchCacheMiddleware,
  searchAnalyticsMiddleware,
  searchLoggingMiddleware,
];

export const advancedSearchMiddleware = [
  searchSecurityMiddleware,
  advancedSearchPermission,
  searchCacheMiddleware,
  searchAnalyticsMiddleware,
  searchLoggingMiddleware,
];

// Cache management endpoints (admin only)
export const getCacheStats = (req, res) => {
  if (req.user?.role !== "admin") {
    throw new ApiError(403, "Admin access required");
  }

  const stats = searchCache.getStats();
  return res.json({
    success: true,
    data: stats,
    message: "Cache statistics retrieved",
  });
};

export const clearCache = (req, res) => {
  if (req.user?.role !== "admin") {
    throw new ApiError(403, "Admin access required");
  }

  const oldStats = searchCache.getStats();
  searchCache.clear();

  return res.json({
    success: true,
    data: {
      cleared: oldStats.size,
      oldStats,
      newStats: searchCache.getStats(),
    },
    message: "Cache cleared successfully",
  });
};
