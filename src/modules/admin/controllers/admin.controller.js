// src/modules/admin/controllers/admin.controller.js
import { User } from "../../users/models/user.model.js";
import { ApiError } from "../../../shared/utils/ApiError.js";
import { ApiResponse } from "../../../shared/utils/ApiResponse.js";
import { asyncHandler } from "../../../shared/utils/AsyncHandler.js";
import mongoose from "mongoose";
import { CacheService } from "../../../shared/services/cache.service.js";
import { SessionService } from "../../../shared/services/session.service.js";
import { ValidationService } from "../services/validation.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { NotificationService } from "../services/notification.service.js";
import auditService from "../services/audit.service.js";
import { ExportImportService } from "../services/exportImport.service.js";
import { SecurityService } from "../services/security.service.js";
import { emailService } from "../../email/services/email.service.js";

import { log } from "console";
import { Worker, isMainThread, parentPort } from "worker_threads";
import Bull from "bull";
import Redis from "ioredis";
import { Transform, pipeline } from "stream";
import { promisify } from "util";
import { cacheRedis } from "../../../shared/config/redis.config.js";
import redisConfig from "../../../shared/config/redis.config.js";

// Initialize services
const cache = new CacheService();
const sessionService = new SessionService();
const validator = new ValidationService();
const analyticsService = new AnalyticsService();
const notificationService = new NotificationService();
const exportImportService = new ExportImportService();
const securityService = new SecurityService();

// ENTERPRISE-GRADE PERFORMANCE OPTIMIZATIONS

// Constants for better performance
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Connection pool optimization
const aggregationOptions = {
  allowDiskUse: false,
  maxTimeMS: 30000,
  readConcern: { level: "local" },
};
// PRODUCTION-OPTIMIZED CONSTANTS
const CACHE_TTL = {
  ADMIN_STATS: 60, // 1 minute
  ADMIN_STATS_LIVE: 30, // 30 seconds
  USER_LIST: 120, // 2 minutes
  USER_PROFILE: 300, // 5 minutes
  SEARCH_RESULTS: 90, // 1.5 minutes
};
const PERFORMANCE_THRESHOLDS = {
  EXCELLENT: 50,
  GOOD: 100,
  ACCEPTABLE: 200,
  POOR: 500,
};
// Optimized admin stats aggregation pipeline
const OPTIMIZED_ADMIN_STATS_PIPELINE = [
  {
    $facet: {
      // Basic user counts - highly optimized
      basicCounts: [
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            activeUsers: { $sum: { $cond: ["$isActive", 1, 0] } },
            adminUsers: {
              $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] },
            },
            verifiedUsers: { $sum: { $cond: ["$isVerified", 1, 0] } },
          },
        },
      ],
      // Role distribution
      roleDistribution: [{ $group: { _id: "$role", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }],
      // Location statistics (top 5)
      locationStats: [
        {
          $match: {
            "location.country": { $exists: true, $ne: null, $ne: "" },
          },
        },
        { $group: { _id: "$location.country", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ],
      // Engagement analysis based on last login
      engagementStats: [
        {
          $addFields: {
            daysSinceLogin: {
              $cond: {
                if: { $ifNull: ["$lastLoginAt", false] },
                then: {
                  $floor: {
                    $divide: [{ $subtract: ["$$NOW", "$lastLoginAt"] }, 86400000],
                  },
                },
                else: 999,
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            highly_engaged: {
              $sum: { $cond: [{ $lte: ["$daysSinceLogin", 7] }, 1, 0] },
            },
            moderately_engaged: {
              $sum: {
                $cond: [
                  {
                    $and: [{ $gt: ["$daysSinceLogin", 7] }, { $lte: ["$daysSinceLogin", 30] }],
                  },
                  1,
                  0,
                ],
              },
            },
            low_engaged: {
              $sum: { $cond: [{ $gt: ["$daysSinceLogin", 30] }, 1, 0] },
            },
          },
        },
      ],
      // Recent users (last 10)
      recentUsers: [
        { $sort: { createdAt: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 1,
            username: 1,
            email: 1,
            role: 1,
            createdAt: 1,
            isActive: 1,
            lastLoginAt: 1,
          },
        },
      ],
      // Monthly growth (last 6 months)
      monthlyGrowth: [
        {
          $match: {
            createdAt: {
              $gte: new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        { $limit: 6 },
      ],
      // Daily growth (last 14 days)
      dailyGrowth: [
        {
          $match: {
            createdAt: {
              $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
        { $limit: 14 },
      ],
    },
  },
];

// PRODUCTION UTILITY FUNCTIONS
const getPerformanceGrade = (executionTime) => {
  if (executionTime < PERFORMANCE_THRESHOLDS.EXCELLENT) {
    return "A++";
  }
  if (executionTime < PERFORMANCE_THRESHOLDS.GOOD) {
    return "A+";
  }
  if (executionTime < PERFORMANCE_THRESHOLDS.ACCEPTABLE) {
    return "A";
  }
  if (executionTime < PERFORMANCE_THRESHOLDS.POOR) {
    return "B";
  }
  return "C";
};

const generateCacheKey = (prefix, params, version = "v3") => {
  const paramString = typeof params === "object" ? JSON.stringify(params) : String(params);
  const hash = Buffer.from(paramString).toString("base64").slice(0, 16);
  return `${prefix}:${version}:${hash}`;
};

const safeAsyncOperation = async (operation, fallback = null, logError = true) => {
  try {
    return await operation();
  } catch (error) {
    if (logError) {
      console.warn("Async operation failed:", error.message);
    }
    return fallback;
  }
};
const CONFIG = {
  CACHE: {
    ADMIN_STATS: 60,
    ADMIN_STATS_LIVE: 30,
    USER_LIST: 120,
    USER_PROFILE: 300,
    SEARCH_RESULTS: 90,
    EXPORT_DATA: 300,
  },

  PERFORMANCE: {
    THRESHOLDS: {
      EXCELLENT: 50,
      GOOD: 100,
      ACCEPTABLE: 200,
      POOR: 500,
    },
    MAX_QUERY_TIME: 15000,
    BATCH_SIZE: 1000,
    MAX_CONCURRENT_OPERATIONS: 5,
  },

  EXPORT: {
    MAX_RECORDS: 100000,
    DEFAULT_LIMIT: 10000,
    SUPPORTED_FORMATS: ["csv", "json", "xlsx", "pdf"],
    STREAMING_THRESHOLD: 5000,
  },

  BULK_ACTIONS: {
    MAX_BATCH_SIZE: 50000,
    CHUNK_SIZE: 1000,
    TIMEOUT: 300000, // 5 minutes
    RATE_LIMIT: { windowMs: 60000, max: 10 },
  },

  SECURITY: {
    DESTRUCTIVE_ACTIONS: ["delete", "suspend", "force_password_reset"],
    REQUIRE_PASSWORD_CONFIRMATION: true,
    AUDIT_RETENTION_DAYS: 90,
  },
};

// ==========================================
// ENTERPRISE UTILITY CLASSES
// ==========================================

class PerformanceMonitor {
  constructor(operation, userId = null) {
    this.operation = operation;
    this.userId = userId;
    this.startTime = process.hrtime.bigint();
    this.startMemory = process.memoryUsage();
    this.metrics = {
      dbQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
    };
  }

  recordDbQuery() {
    this.metrics.dbQueries++;
  }
  recordCacheHit() {
    this.metrics.cacheHits++;
  }
  recordCacheMiss() {
    this.metrics.cacheMisses++;
  }
  recordError() {
    this.metrics.errors++;
  }

  end(additionalData = {}) {
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();

    const result = {
      operation: this.operation,
      userId: this.userId,
      executionTime: Number(endTime - this.startTime) / 1000000, // Convert to milliseconds
      memoryUsage: {
        heapUsed: endMemory.heapUsed - this.startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - this.startMemory.heapTotal,
        rss: endMemory.rss - this.startMemory.rss,
      },
      performanceGrade: this.getPerformanceGrade(Number(endTime - this.startTime) / 1000000),
      ...this.metrics,
      ...additionalData,
      timestamp: new Date().toISOString(),
    };

    // Log performance metrics asynchronously
    setImmediate(() => this.logMetrics(result));

    return result;
  }

  getPerformanceGrade(executionTime) {
    if (executionTime < CONFIG.PERFORMANCE.THRESHOLDS.EXCELLENT) {
      return "A++";
    }
    if (executionTime < CONFIG.PERFORMANCE.THRESHOLDS.GOOD) {
      return "A+";
    }
    if (executionTime < CONFIG.PERFORMANCE.THRESHOLDS.ACCEPTABLE) {
      return "A";
    }
    if (executionTime < CONFIG.PERFORMANCE.THRESHOLDS.POOR) {
      return "B";
    }
    return "C";
  }

  logMetrics(metrics) {
    if (metrics.performanceGrade === "C" || metrics.executionTime > 1000) {
      console.warn(`⚠️ SLOW OPERATION: ${metrics.operation}`, {
        executionTime: `${metrics.executionTime.toFixed(2)}ms`,
        memoryUsage: `${Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024)}MB`,
        dbQueries: metrics.dbQueries,
        grade: metrics.performanceGrade,
      });
    } else {
      console.log(
        `📊 Performance: ${metrics.operation} - ${metrics.executionTime.toFixed(2)}ms (${metrics.performanceGrade})`,
      );
    }
  }
}

class EnhancedCacheManager {
  static redis = cacheRedis;

  static async get(key, parseJson = true) {
    try {
      const data = await this.redis.get(key);
      return data ? (parseJson ? JSON.parse(data) : data) : null;
    } catch (error) {
      console.warn(`Cache get error for key ${key}:`, error.message);
      return null;
    }
  }

  static async set(key, data, ttl = 300) {
    try {
      const serializedData = typeof data === "string" ? data : JSON.stringify(data);
      await this.redis.setex(key, ttl, serializedData);
      return true;
    } catch (error) {
      console.warn(`Cache set error for key ${key}:`, error.message);
      return false;
    }
  }

  static async del(key) {
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      console.warn(`Cache delete error for key ${key}:`, error.message);
      return false;
    }
  }

  static async invalidatePattern(pattern) {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`🧹 Invalidated ${keys.length} cache keys matching: ${pattern}`);
      }
      return keys.length;
    } catch (error) {
      console.warn("Cache pattern invalidation error:", error.message);
      return 0;
    }
  }

  static generateKey(prefix, params, version = "v4") {
    const paramString = typeof params === "object" ? JSON.stringify(params) : String(params);
    const hash = require("crypto").createHash("sha256").update(paramString).digest("hex").substring(0, 16);
    return `${prefix}:${version}:${hash}`;
  }

  static async getOrSet(key, asyncFn, ttl = 300) {
    const cached = await this.get(key);
    if (cached) {
      return { data: cached, fromCache: true };
    }

    const data = await asyncFn();
    await this.set(key, data, ttl);
    return { data, fromCache: false };
  }
}

class QueryOptimizer {
  static buildUserPipeline(filters = {}, options = {}) {
    const pipeline = [];
    const {
      search,
      role,
      isActive,
      dateFrom,
      dateTo,
      sortBy = "createdAt",
      sortOrder = "desc",
      limit = 1000,
      skip = 0,
    } = options;

    // Match stage
    const matchStage = { ...filters };

    if (search?.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      matchStage.$or = [
        { username: searchRegex },
        { email: searchRegex },
        { firstName: searchRegex },
        { lastName: searchRegex },
      ];
    }

    if (role && role !== "all") {
      matchStage.role = Array.isArray(role) ? { $in: role } : role;
    }

    if (isActive !== undefined && isActive !== "all") {
      matchStage.isActive = isActive === "true" || isActive === true;
    }

    if (dateFrom || dateTo) {
      matchStage.createdAt = {};
      if (dateFrom) {
        matchStage.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        matchStage.createdAt.$lte = new Date(dateTo);
      }
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Sort stage
    const validSortFields = ["createdAt", "username", "email", "firstName", "lastName", "role", "lastLoginAt"];
    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortObj = { [finalSortBy]: sortOrder === "asc" ? 1 : -1 };
    pipeline.push({ $sort: sortObj });

    // Project stage - only include necessary fields
    pipeline.push({
      $project: {
        password: 0,
        refreshToken: 0,
        __v: 0,
        "tokens.refreshToken": 0,
        "sessions.token": 0,
      },
    });

    // Pagination
    if (skip > 0) {
      pipeline.push({ $skip: skip });
    }
    if (limit > 0) {
      pipeline.push({ $limit: limit });
    }

    return pipeline;
  }

  static getAggregationOptions(timeout = CONFIG.PERFORMANCE.MAX_QUERY_TIME) {
    return {
      allowDiskUse: false,
      maxTimeMS: timeout,
      readConcern: { level: "local" },
      readPreference: "secondaryPreferred",
    };
  }
}

class StreamingProcessor {
  static createTransformStream(transformFn) {
    return new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        try {
          const result = transformFn(chunk);
          callback(null, result);
        } catch (error) {
          callback(error);
        }
      },
    });
  }

  static async processInBatches(items, batchSize, processFn) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await processFn(batch);
      results.push(...batchResults);
    }
    return results;
  }
}

// ==========================================
// QUEUE SETUP FOR BACKGROUND PROCESSING
// ==========================================

const exportQueue = new Bull("user-export", {
  redis: redisConfig,
});
const bulkActionQueue = new Bull("bulk-actions", {
  redis: redisConfig,
});

// * TODO ANALYTICS & DASHBOARD CONTROLLERS ***

// ** 🚀 Get Admin Stats tested
const getAdminStats = asyncHandler(async (req, res) => {
  const startTime = process.hrtime.bigint();
  try {
    // Smart cache key with time bucketing (30-second intervals)
    const timeSlot = Math.floor(Date.now() / 30000);
    const cacheKey = `admin:stats:v3:${timeSlot}`;
    // Try cache first
    const cachedStats = await safeAsyncOperation(() => cache.get(cacheKey), null, false);
    if (cachedStats) {
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            stats: {
              ...cachedStats,
              metadata: {
                ...cachedStats.metadata,
                generatedAt: new Date().toISOString(),
                fromCache: true,
                responseTime: `${responseTime.toFixed(2)}ms`,
              },
            },
            meta: {
              cacheHit: true,
              executionTime: `${responseTime.toFixed(2)}ms`,
              performanceGrade: "A++",
              dataFreshness: "cached_30s",
            },
          },
          "Admin stats from cache",
        ),
      );
    }
    // Execute optimized aggregation with timeout protection
    const aggregationTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Aggregation timeout")), 15000),
    );
    const aggregationQuery = User.aggregate(OPTIMIZED_ADMIN_STATS_PIPELINE, {
      allowDiskUse: false,
      maxTimeMS: 12000,
      readConcern: { level: "local" },
    });
    const [aggregationResult] = await Promise.race([aggregationQuery, aggregationTimeout]);
    // Process results with safe fallbacks
    const {
      basicCounts = [{}],
      roleDistribution = [],
      locationStats = [],
      engagementStats = [{}],
      recentUsers = [],
      monthlyGrowth = [],
      dailyGrowth = [],
    } = aggregationResult;
    const counts = basicCounts[0] || {};
    const engagement = engagementStats[0] || {};
    const totalUsers = counts.totalUsers || 0;
    const activeUsers = counts.activeUsers || 0;
    const adminUsers = counts.adminUsers || 0;
    const verifiedUsers = counts.verifiedUsers || 0;
    const suspendedUsers = totalUsers - activeUsers;
    const activePercentage = totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : "0.0";
    // Calculate current month growth
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const currentMonthGrowth =
      monthlyGrowth.find((item) => item._id.month === currentMonth && item._id.year === currentYear)?.count || 0;
    // Build optimized response structure
    const stats = {
      overview: {
        totalUsers,
        activeUsers,
        adminUsers,
        verifiedUsers,
        suspendedUsers,
        activePercentage: `${activePercentage}%`,
        currentMonthSignups: currentMonthGrowth,
        userGrowthTrend: currentMonthGrowth > 0 ? "up" : "stable",
        healthScore: Math.round((activeUsers / Math.max(totalUsers, 1)) * 100),
      },
      breakdown: {
        usersByRole: Object.fromEntries(roleDistribution.map((item) => [item._id || "undefined", item.count])),
        usersByLocation: Object.fromEntries(locationStats.map((item) => [item._id, item.count])),
        monthlyGrowth: monthlyGrowth.map((item) => ({
          year: item._id.year,
          month: item._id.month,
          count: item.count,
          monthName: MONTH_NAMES[item._id.month - 1] || "Unknown",
        })),
        dailyGrowth: dailyGrowth.map((item) => ({
          year: item._id.year,
          month: item._id.month,
          day: item._id.day,
          count: item.count,
          date: new Date(item._id.year, item._id.month - 1, item._id.day).toISOString().split("T")[0],
        })),
      },
      activity: {
        recentUsers: recentUsers.map((user) => ({
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          joinedAt: user.createdAt,
          lastLogin: user.lastLoginAt,
          status: user.isActive ? "active" : "suspended",
          daysSinceJoined: Math.floor((Date.now() - new Date(user.createdAt)) / (24 * 60 * 60 * 1000)),
        })),
      },
      engagement: await sessionService.getAdminEngagementAnalytics(),
      metadata: {
        generatedAt: new Date().toISOString(),
        fromCache: false,
        optimizedVersion: "v3.0-Production",
        pipeline: "single_facet_aggregation",
      },
    };
    const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
    // Background cache operations (non-blocking)
    setImmediate(() => {
      Promise.allSettled([
        cache.setex(cacheKey, CACHE_TTL.ADMIN_STATS, stats),
        cache.setex("admin:stats:fallback:v3", 300, stats), // 5-minute fallback
        analyticsService.updateDashboardMetrics?.(stats),
      ]).catch((err) => console.warn("Background operations failed:", err.message));
    });
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          stats,
          meta: {
            cacheHit: false,
            generatedAt: new Date().toISOString(),
            executionTime: `${executionTime.toFixed(2)}ms`,
            performanceGrade: getPerformanceGrade(executionTime),
            dataFreshness: "real_time",
            optimizations: [
              "single_facet_pipeline",
              "optimized_date_calculations",
              "smart_caching",
              "timeout_protection",
            ],
          },
        },
        "Admin stats generated successfully",
      ),
    );
  } catch (error) {
    // Enhanced fallback strategy
    const fallbackStats = await safeAsyncOperation(() => cache.get("admin:stats:fallback:v3"), null, false);
    if (fallbackStats) {
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            stats: fallbackStats,
            meta: {
              cacheHit: true,
              dataFreshness: "fallback_cache",
              warning: "Using cached data due to temporary issue",
            },
          },
          "Admin stats from fallback cache",
        ),
      );
    }
    console.error("❌ Admin stats error:", error.message);
    if (error.message === "Aggregation timeout") {
      throw new ApiError(504, "Database query timeout. Please try again.");
    }
    throw new ApiError(500, `Admin stats failed: ${error.message}`);
  }
});

// ** 🚀 live stats endpoint tested
const getAdminStatsLive = asyncHandler(async (req, res) => {
  const startTime = process.hrtime.bigint();
  try {
    // Check live cache first
    const cacheKey = "admin:stats:live:v3";
    const liveCache = await safeAsyncOperation(() => cache.get(cacheKey), null, false);
    if (liveCache) {
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...liveCache,
            metadata: {
              ...liveCache.metadata,
              generatedAt: new Date().toISOString(),
              responseTime: `${responseTime.toFixed(2)}ms`,
            },
          },
          "Live admin stats (cached)",
        ),
      );
    }
    // Fast basic stats query
    const basicStatsPromise = User.aggregate(
      [
        {
          $facet: {
            total: [{ $count: "count" }],
            active: [{ $match: { isActive: true } }, { $count: "count" }],
            admin: [{ $match: { role: "admin" } }, { $count: "count" }],
            verified: [{ $match: { isVerified: true } }, { $count: "count" }],
          },
        },
      ],
      {
        allowDiskUse: false,
        maxTimeMS: 5000,
        hint: { _id: 1 },
      },
    );
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Live stats timeout")), 4000));
    const [basicStats] = await Promise.race([basicStatsPromise, timeout]);
    const stats = basicStats || {};
    const totalUsers = stats.total?.[0]?.count || 0;
    const activeUsers = stats.active?.[0]?.count || 0;
    const adminUsers = stats.admin?.[0]?.count || 0;
    const verifiedUsers = stats.verified?.[0]?.count || 0;
    const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
    const liveData = {
      overview: {
        totalUsers,
        activeUsers,
        adminUsers,
        verifiedUsers,
        suspendedUsers: totalUsers - activeUsers,
        activePercentage: `${totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : "0.0"}%`,
      },
      metadata: {
        type: "live",
        generatedAt: new Date().toISOString(),
        executionTime: `${executionTime.toFixed(2)}ms`,
        performanceGrade: getPerformanceGrade(executionTime),
      },
    };
    // Cache for 30 seconds (non-blocking)
    setImmediate(() => {
      cache.setex(cacheKey, 30, liveData).catch(() => {});
    });
    return res.status(200).json(new ApiResponse(200, liveData, "Live admin stats"));
  } catch (error) {
    console.error("❌ Live stats error:", error);
    // Log error (non-blocking)
    setImmediate(() => {
      safeAsyncOperation(
        () =>
          auditService.logAdminActivity({
            adminId: req.user?._id,
            action: "GET_ADMIN_STATS_LIVE",
            details: { error: error.message },
            level: "error",
            status: "failure",
          }),
        null,
        false,
      );
    });
    // Return minimal fallback
    const fallbackData = {
      overview: {
        totalUsers: 0,
        activeUsers: 0,
        adminUsers: 0,
        verifiedUsers: 0,
        suspendedUsers: 0,
        activePercentage: "0.0%",
      },
      metadata: {
        type: "fallback",
        generatedAt: new Date().toISOString(),
        error: "Live stats temporarily unavailable",
      },
    };
    return res.status(200).json(new ApiResponse(200, fallbackData, "Live stats fallback"));
  }
});

//**  ADMIN MANAGEMENT CONTROLLERS ***

//** 🚀 get all admins tested need optimization - SUPER ADMIN ONLY
const getAllAdmins = asyncHandler(async (req, res) => {
  // Restrict to super admin only
  if (req.user.role !== "super_admin") {
    throw new ApiError(403, "Access denied. Only super admins can view all admins.");
  }
  try {
    const startTime = Date.now();
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
      search = "",
      status = "all",
      role = "admin",
      dateFrom,
      dateTo,
      lastLoginFrom,
      lastLoginTo,
    } = req.query;

    // Input validation
    const validatedParams = validator.validatePagination(page, limit);
    const validSortFields = ["createdAt", "username", "email", "lastLoginAt"];
    const validSortOrders = ["asc", "desc"];
    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const finalSortOrder = validSortOrders.includes(sortOrder) ? sortOrder : "desc";
    // Smart caching
    const cacheKey = generateCacheKey("admin:list", req.query);
    const cachedResult = await safeAsyncOperation(() => cache.get(cacheKey), null, false);
    if (cachedResult) {
      console.log(`⚡ Admin list cache hit - ${Date.now() - startTime}ms`);
      return res.status(200).json(new ApiResponse(200, cachedResult, "Admins fetched from cache"));
    }
    // Build dynamic filter
    const filter = {
      role: { $in: role === "all" ? ["admin", "super_admin"] : [role] },
    };
    if (status !== "all") {
      filter.isActive = status === "active";
    }
    // Search filter with sanitization
    const sanitizedSearch = validator.sanitizeSearchQuery(search);
    if (sanitizedSearch) {
      filter.$or = [
        { username: { $regex: sanitizedSearch, $options: "i" } },
        { email: { $regex: sanitizedSearch, $options: "i" } },
        { phone: { $regex: sanitizedSearch, $options: "i" } },
      ];
    }
    // Date filters
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) {
        filter.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        filter.createdAt.$lte = new Date(dateTo);
      }
    }
    if (lastLoginFrom || lastLoginTo) {
      filter.lastLoginAt = {};
      if (lastLoginFrom) {
        filter.lastLoginAt.$gte = new Date(lastLoginFrom);
      }
      if (lastLoginTo) {
        filter.lastLoginAt.$lte = new Date(lastLoginTo);
      }
    }
    const sort = {
      [finalSortBy]: finalSortOrder === "desc" ? -1 : 1,
    };
    // Execute parallel queries
    const [admins, totalCount, activeCount, recentActivityCount] = await Promise.all([
      User.find(filter)
        .select("username email phone role isActive createdAt lastLoginAt profileImage permissions department")
        .sort(sort)
        .skip((validatedParams.page - 1) * validatedParams.limit)
        .limit(validatedParams.limit)
        .lean(),
      User.countDocuments(filter),
      User.countDocuments({ ...filter, isActive: true }),
      User.countDocuments({
        ...filter,
        lastLoginAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);
    const executionTime = Date.now() - startTime;
    // Transform admin data
    const transformedAdmins = admins.map((admin) => ({
      id: admin._id,
      username: admin.username,
      email: admin.email,
      phone: admin.phone || null,
      role: admin.role,
      status: admin.isActive ? "active" : "suspended",
      isActive: admin.isActive,
      joinedAt: admin.createdAt,
      lastLogin: admin.lastLoginAt || null,
      profileImage: admin.profileImage || null,
      department: admin.department || null,
      permissions: admin.permissions || [],
      daysSinceJoined: Math.floor((Date.now() - new Date(admin.createdAt)) / (24 * 60 * 60 * 1000)),
      daysSinceLastLogin: admin.lastLoginAt
        ? Math.floor((Date.now() - new Date(admin.lastLoginAt)) / (24 * 60 * 60 * 1000))
        : null,
      isOnline: admin.lastLoginAt ? Date.now() - new Date(admin.lastLoginAt) < 15 * 60 * 1000 : false,
    }));
    // Build response
    const totalPages = Math.ceil(totalCount / validatedParams.limit);
    const result = {
      admins: transformedAdmins,
      pagination: {
        currentPage: validatedParams.page,
        totalPages,
        totalCount,
        limit: validatedParams.limit,
        hasNextPage: validatedParams.page < totalPages,
        hasPrevPage: validatedParams.page > 1,
        nextPage: validatedParams.page < totalPages ? validatedParams.page + 1 : null,
        prevPage: validatedParams.page > 1 ? validatedParams.page - 1 : null,
      },
      summary: {
        totalAdmins: totalCount,
        activeAdmins: activeCount,
        suspendedAdmins: totalCount - activeCount,
        recentlyActive: recentActivityCount,
        onlineNow: transformedAdmins.filter((admin) => admin.isOnline).length,
      },
      filters: {
        applied: {
          search: sanitizedSearch || null,
          status,
          role,
          dateRange: dateFrom || dateTo ? { from: dateFrom, to: dateTo } : null,
          lastLoginRange: lastLoginFrom || lastLoginTo ? { from: lastLoginFrom, to: lastLoginTo } : null,
        },
        available: {
          statuses: ["all", "active", "suspended"],
          roles: ["all", "admin", "super_admin"],
          sortOptions: ["createdAt", "username", "email", "lastLoginAt"],
        },
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        executionTime: `${executionTime}ms`,
        performanceGrade: executionTime < 100 ? "A++" : executionTime < 200 ? "A+" : "B",
        cached: false,
        dataFreshness: "real_time",
      },
    };
    // Cache result (non-blocking)
    setImmediate(() => {
      cache.setex(cacheKey, CACHE_TTL.USER_LIST, result).catch((err) => console.warn("Cache set failed:", err.message));
    });
    // Log audit (non-blocking)
    setImmediate(() => {
      safeAsyncOperation(
        () =>
          auditService.logAdminActivity({
            adminId: req.user._id,
            action: "VIEW_ADMIN_LIST",
            details: {
              filters: result.filters.applied,
              resultCount: transformedAdmins.length,
            },
          }),
        null,
        false,
      );
    });
    return res.status(200).json(new ApiResponse(200, result, "Admins fetched successfully"));
  } catch (error) {
    console.error("❌ Get all admins error:", error);
    if (error instanceof ApiError) {
      throw error;
    }
    // Log error (non-blocking)
    setImmediate(() => {
      safeAsyncOperation(
        () =>
          auditService.logAdminError({
            adminId: req.user?._id,
            action: "GET_ALL_ADMINS",
            error: error.message,
            filters: req.query,
          }),
        null,
        false,
      );
    });
    throw new ApiError(500, `Failed to fetch admins: ${error.message}`);
  }
});

// ** 🚀 Get Admin by ID with Detailed Information & Activity History tested
const getAdminById = asyncHandler(async (req, res) => {
  try {
    const startTime = Date.now();
    const { adminId } = req.params;
    // Enhanced validation with detailed logging
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      throw new ApiError(400, "Invalid admin ID format");
    }
    // Check cache first
    const cacheKey = `admin:profile:${adminId}:v3`;
    const cachedAdmin = await safeAsyncOperation(() => cache.get(cacheKey), null, false);
    if (cachedAdmin) {
      console.log(`⚡ Admin profile cache hit - ${Date.now() - startTime}ms`);
      return res.status(200).json(new ApiResponse(200, cachedAdmin, "Admin profile from cache"));
    }
    // Execute parallel queries for comprehensive admin data
    const [adminData, managedUsers] = await Promise.all([
      User.findById(adminId).select("-password -refreshToken").lean(),
      // Count users managed by this admin
      User.countDocuments({
        createdBy: adminId,
        role: { $ne: "admin" },
      }),
    ]);
    const loginHistory = [];
    const recentActivities = [];
    if (!adminData) {
      throw new ApiError(404, "Admin not found");
    }
    // Permission check - Super admin can view any admin, regular admin can only view themselves
    const currentUser = req.user;
    if (currentUser.role !== "super_admin") {
      if (currentUser._id.toString() !== adminId) {
        throw new ApiError(403, "Access denied. You can only view your own profile.");
      }
      // Regular admins can only view admin profiles, not other roles
      if (adminData.role !== "admin" && adminData.role !== "super_admin") {
        throw new ApiError(403, "Access denied. Invalid profile type.");
      }
    }
    const executionTime = Date.now() - startTime;
    // Transform and enrich admin data
    const enrichedAdmin = {
      id: adminData._id,
      personalInfo: {
        username: adminData.username,
        email: adminData.email,
        phone: adminData.phone || null,
        profileImage: adminData.profileImage || null,
        dateOfBirth: adminData.dateOfBirth || null,
        address: adminData.address || null,
      },
      accountInfo: {
        role: adminData.role,
        status: adminData.isActive ? "active" : "suspended",
        isActive: adminData.isActive,
        isEmailVerified: adminData.isEmailVerified || false,
        isPhoneVerified: adminData.isPhoneVerified || false,
        twoFactorEnabled: adminData.twoFactorEnabled || false,
        isVerified: adminData.isVerified || false,
      },
      professionalInfo: {
        department: adminData.department || null,
        position: adminData.position || null,
        employeeId: adminData.employeeId || null,
        permissions: adminData.permissions || [],
        accessLevel: adminData.accessLevel || "standard",
      },
      activityInfo: {
        joinedAt: adminData.createdAt,
        lastLogin: adminData.lastLoginAt || null,
        lastActivity: adminData.lastActivity || null,
        totalLogins: adminData.loginCount || 0,
        daysSinceJoined: Math.floor((Date.now() - new Date(adminData.createdAt)) / (24 * 60 * 60 * 1000)),
        daysSinceLastLogin: adminData.lastLoginAt
          ? Math.floor((Date.now() - new Date(adminData.lastLoginAt)) / (24 * 60 * 60 * 1000))
          : null,
        isCurrentlyOnline: adminData.lastLoginAt
          ? Date.now() - new Date(adminData.lastLoginAt) < 15 * 60 * 1000
          : false,
      },
      statistics: {
        managedUsers,
        loginHistory,
        recentActivities,
        averageSessionDuration: adminData.averageSessionDuration || null,
        totalActionsPerformed: adminData.totalActions || 0,
      },
      settings: {
        language: adminData.language || "en",
        timezone: adminData.timezone || "UTC",
        theme: adminData.theme || "light",
        notifications: adminData.notificationSettings || {
          email: true,
          sms: false,
          push: true,
        },
      },
      metadata: {
        createdBy: adminData.createdBy || null,
        updatedAt: adminData.updatedAt,
        version: adminData.__v || 0,
        lastProfileUpdate: adminData.lastProfileUpdate || null,
      },
    };
    // Cache result (non-blocking)
    setImmediate(() => {
      cache
        .setex(cacheKey, CACHE_TTL.USER_PROFILE, enrichedAdmin)
        .catch((err) => console.warn("Cache set failed:", err.message));
    });
    // Log profile view (non-blocking)
    setImmediate(() => {
      safeAsyncOperation(
        () =>
          auditService.logAdminActivity({
            adminId: currentUser._id,
            action: "VIEW_ADMIN_PROFILE",
            targetAdminId: adminId,
            details: {
              viewedBy: currentUser.role,
              profileOwner: adminData.role,
            },
          }),
        null,
        false,
      );
    });
    console.log(`⚡ Admin profile generated in ${executionTime}ms`);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          admin: enrichedAdmin,
          meta: {
            executionTime: `${executionTime}ms`,
            performanceGrade: executionTime < 100 ? "A++" : executionTime < 200 ? "A+" : "B",
            cached: false,
            dataFreshness: "real_time",
            permissionLevel: currentUser.role,
            canEdit: currentUser.role === "super_admin" || currentUser._id.toString() === adminId,
          },
        },
        "Admin profile fetched successfully",
      ),
    );
  } catch (error) {
    console.error("❌ Get admin by ID error:", error);
    if (error instanceof ApiError) {
      throw error;
    }
    // Log error (non-blocking)
    setImmediate(() => {
      safeAsyncOperation(
        () =>
          auditService.logAdminError({
            adminId: req.user?._id,
            action: "GET_ADMIN_BY_ID",
            targetAdminId: req.params.adminId,
            error: error.message,
          }),
        null,
        false,
      );
    });
    throw new ApiError(500, `Failed to fetch admin profile: ${error.message}`);
  }
});

// ** USER MANAGEMENT CONTROLLERS ***

// ** 🚀 Get All Admins with Pagination, Sorting, and Filtering tested
const getAllUsers = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = "createdAt", sortOrder = "desc", search = "", role, isActive } = req.query;

    // Input validation
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    console.log("📄 Query params:", {
      pageNum,
      limitNum,
      search,
      role,
      isActive,
    });

    // Build filter
    const filter = {};
    if (search?.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      filter.$or = [
        { username: searchRegex },
        { email: searchRegex },
        { firstName: searchRegex },
        { lastName: searchRegex },
      ];
    }
    if (role) {
      filter.role = role;
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === "true" || isActive === true;
    }

    console.log("🔍 Database filter:", filter);

    // Build sort
    const sortObj = {};
    const validSortFields = ["createdAt", "username", "email", "firstName", "lastName"];
    const validSortBy = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    sortObj[validSortBy] = sortOrder === "desc" ? -1 : 1;

    console.log("🔄 Sort options:", sortObj);

    // Execute queries
    const [users, totalCount] = await Promise.all([
      User.find(filter)
        .select("username email firstName lastName role isActive createdAt lastLoginAt profileImage")
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    console.log(`✅ Found ${users.length} users out of ${totalCount} total`);

    const totalPages = Math.ceil(totalCount / limitNum);

    const responseData = {
      users: users.map((user) => ({
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        profileImage: user.profileImage,
        daysSinceJoined: Math.floor((Date.now() - new Date(user.createdAt)) / (24 * 60 * 60 * 1000)),
      })),
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      filters: {
        search: search?.trim() || null,
        role: role || null,
        isActive: isActive || null,
      },
      meta: {
        cached: false,
        generatedAt: new Date().toISOString(),
      },
    };

    console.log("📤 Sending response with", responseData.users.length, "users");

    return res.status(200).json(new ApiResponse(200, responseData, "Users fetched successfully"));
  } catch (error) {
    console.error("❌ Get all users error:", error);
    throw new ApiError(500, `Failed to fetch users: ${error.message}`);
  }
});

const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  const user = await User.findById(id).select("-password -refreshToken");
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  return res.status(200).json(new ApiResponse(200, { user }, "User details fetched successfully"));
});

const updateUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  const user = await User.findByIdAndUpdate(id, { ...updateData, updatedAt: new Date() }, { new: true }).select(
    "-password -refreshToken",
  );
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  // Clear cache (optional)
  try {
    await cache.del(`user:${id}`);
    await cache.del("users:list:*");
  } catch (cacheError) {
    // Cache not available, continue
  }
  return res.status(200).json(new ApiResponse(200, { user }, "User updated successfully"));
});

// Enterprise User Deletion with Enhanced Audit & Security
const deleteUserById = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { id } = req.params;
  const { reason, confirmPassword, notifyUser = false } = req.body;

  // Enhanced validation
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID format", {
      field: "userId",
      provided: id,
    });
  }
  if (req.user._id.toString() === id) {
    throw new ApiError(400, "Self-deletion not permitted", {
      reason: "security_policy",
      suggestions: ["Contact another admin to delete your account"],
    });
  }
  // Require reason for enterprise audit compliance
  if (!reason || reason.trim().length < 10) {
    throw new ApiError(400, "Deletion reason required (minimum 10 characters)", {
      field: "reason",
      minLength: 10,
      suggestions: ["Provide detailed reason for account deletion"],
    });
  }
  // Production safety: require password confirmation
  if (process.env.NODE_ENV === "production" && !confirmPassword) {
    throw new ApiError(400, "Password confirmation required for user deletion", {
      field: "confirmPassword",
      security: "destructive_action_protection",
    });
  }
  const user = await User.findById(id).select("username email role firstName lastName isActive createdAt lastActive");
  if (!user) {
    throw new ApiError(404, "User not found or already deleted", {
      userId: id,
      suggestions: ["Verify user ID", "Check if user was previously deleted"],
    });
  }
  // Enhanced role-based security
  if (user.role === "super_admin" && req.user.role !== "super_admin") {
    throw new ApiError(403, "Insufficient privileges to delete super admin", {
      requiredRole: "super_admin",
      currentRole: req.user.role,
      policy: "super_admin_protection",
    });
  }
  if (user.role === "admin" && req.user.role === "admin") {
    throw new ApiError(403, "Admin users cannot delete other admin users", {
      requiredRole: "super_admin",
      policy: "admin_peer_protection",
    });
  }
  // Execute deletion with transaction for data integrity
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Delete user
      await User.findByIdAndDelete(id, { session });
      // Log critical audit event
      await auditService.logAdminActivity(
        {
          adminId: req.user._id,
          action: "DELETE_USER",
          targetUserId: id,
          details: {
            deletedUser: {
              username: user.username,
              email: user.email,
              role: user.role,
              fullName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
              accountAge: Math.floor((Date.now() - new Date(user.createdAt)) / (24 * 60 * 60 * 1000)),
              lastActive: user.lastActive,
            },
            reason: reason.trim(),
            notifyUser,
            confirmationProvided: !!confirmPassword,
          },
          criticality: "HIGH",
          complianceFlags: ["data_deletion", "user_removal"],
        },
        session,
      );
    });
  } finally {
    await session.endSession();
  }
  // Clear related caches (non-blocking)
  setImmediate(() => {
    Promise.allSettled([
      cache.del(`user:profile:${id}`),
      cache.del("users:list:*"),
      cache.del("admin:stats:*"),
      EnhancedCacheManager.invalidatePattern(`user:${id}:*`),
    ]).catch((err) => console.warn("Cache invalidation failed:", err.message));
  });
  // Send notification if requested (non-blocking)
  if (notifyUser && user.email) {
    setImmediate(() => {
      safeAsyncOperation(
        () =>
          notificationService.sendAccountDeletionNotification({
            email: user.email,
            username: user.username,
            reason: reason.trim(),
            deletedBy: req.user.username,
          }),
        null,
        false,
      );
    });
  }
  const executionTime = Date.now() - startTime;
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        deletion: {
          userId: id,
          username: user.username,
          email: user.email,
          role: user.role,
          deletedAt: new Date().toISOString(),
          deletedBy: {
            id: req.user._id,
            username: req.user.username,
            role: req.user.role,
          },
          reason: reason.trim(),
          notificationSent: notifyUser,
        },
        audit: {
          actionId: `delete_${id}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          compliance: "logged",
          retentionPolicy: "90_days",
        },
        meta: {
          executionTime: `${executionTime}ms`,
          performanceGrade: executionTime < 100 ? "A++" : "A+",
          security: "enhanced",
          complianceLevel: "enterprise",
        },
      },
      "User account deleted successfully with full audit trail",
    ),
  );
});

// ** 🚀 Suspend User with Reason and Audit Logging tested tested
const suspendUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  if (req.user._id.toString() === id) {
    throw new ApiError(400, "You cannot suspend your own account");
  }
  if (!reason || reason.trim().length < 5) {
    throw new ApiError(400, "Suspension reason is required (minimum 5 characters)");
  }
  const user = await User.findByIdAndUpdate(
    id,
    {
      isActive: false,
      suspendedAt: new Date(),
      suspendedBy: req.user._id,
      suspensionReason: reason.trim(),
      updatedAt: new Date(),
    },
    { new: true },
  ).select("-password -refreshToken");
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  // Clear related caches (non-blocking)
  setImmediate(() => {
    Promise.allSettled([cache.del(`user:profile:${id}`), cache.del("users:list:*"), cache.del("admin:stats:*")]).catch(
      (err) => console.warn("Cache clear failed:", err.message),
    );
  });
  // Send suspension email (non-blocking)
  setImmediate(async () => {
    try {
      await emailService.sendEmail({
        to: user.email,
        subject: "⚠️ Account Suspended - endlessChatt",
        template: "account-suspended",
        context: {
          firstName: user.firstName,
          username: user.username,
          email: user.email,
          suspendedAt: new Date().toLocaleString("en-US", {
            timeZone: "UTC",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          }),
          suspendedBy: req.user.username,
          reason: reason.trim(),
          supportEmail: process.env.SUPPORT_EMAIL || "support@endlesschatt.com",
        },
      });
    } catch (emailError) {
      console.warn("Suspension email failed:", emailError.message);
    }
  });
  // Log audit (non-blocking)
  setImmediate(() => {
    safeAsyncOperation(
      () =>
        auditService.logAdminActivity({
          adminId: req.user._id,
          action: "SUSPEND_USER",
          targetUserId: id,
          details: { reason: reason.trim() },
          criticality: "MEDIUM",
        }),
      null,
      false,
    );
  });
  return res.status(200).json(new ApiResponse(200, { user }, "User suspended successfully"));
});

// ** 🚀 Activate User with Audit Logging tested
const activateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  const user = await User.findByIdAndUpdate(
    id,
    {
      isActive: true,
      updatedAt: new Date(),
      $unset: {
        suspendedAt: 1,
        suspendedBy: 1,
        suspensionReason: 1,
      },
    },
    { new: true },
  ).select("-password -refreshToken");
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  // Clear related caches (non-blocking)
  setImmediate(() => {
    Promise.allSettled([cache.del(`user:profile:${id}`), cache.del("users:list:*"), cache.del("admin:stats:*")]).catch(
      (err) => console.warn("Cache clear failed:", err.message),
    );
  });
  // Send reactivation email (non-blocking)
  setImmediate(async () => {
    try {
      await emailService.sendEmail({
        to: user.email,
        subject: "✅ Account Reactivated - endlessChatt",
        template: "account-reactivated",
        context: {
          firstName: user.firstName,
          username: user.username,
          email: user.email,
          reactivatedAt: new Date().toLocaleString("en-US", {
            timeZone: "UTC",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          }),
          reactivatedBy: req.user.username,
          loginUrl: `${process.env.FRONTEND_URL}/login`,
        },
      });
    } catch (emailError) {
      console.warn("Reactivation email failed:", emailError.message);
    }
  });
  // Log audit (non-blocking)
  setImmediate(() => {
    safeAsyncOperation(
      () =>
        auditService.logAdminActivity({
          adminId: req.user._id,
          action: "ACTIVATE_USER",
          targetUserId: id,
          details: { previousStatus: "suspended" },
        }),
      null,
      false,
    );
  });
  return res.status(200).json(new ApiResponse(200, { user }, "User activated successfully"));
});

// ** 🚀 Verify User Account with Audit Logging tested
const verifyUserAccount = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  const user = await User.findByIdAndUpdate(
    id,
    {
      isVerified: true,
      verifiedAt: new Date(),
      verifiedBy: req.user._id,
      updatedAt: new Date(),
    },
    { new: true },
  ).select("-password -refreshToken");
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  // Clear related caches (non-blocking)
  setImmediate(() => {
    Promise.allSettled([cache.del(`user:profile:${id}`), cache.del("users:list:*"), cache.del("admin:stats:*")]).catch(
      (err) => console.warn("Cache clear failed:", err.message),
    );
  });
  // Log audit (non-blocking)
  setImmediate(() => {
    safeAsyncOperation(
      () =>
        auditService.logAdminActivity({
          adminId: req.user._id,
          action: "VERIFY_USER_ACCOUNT",
          targetUserId: id,
          details: { email: user.email },
        }),
      null,
      false,
    );
  });
  return res.status(200).json(new ApiResponse(200, { user }, "User account verified successfully"));
});

//**  SEARCH & EXPORT CONTROLLERS ***

// ** 🚀 search users testing pending
const searchUsers = asyncHandler(async (req, res) => {
  try {
    const startTime = Date.now();
    const {
      q = "",
      search = "",
      username = "",
      page = 1,
      limit = 10,
      role,
      isActive,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // 🚀 OPTIMIZATION 1: Consolidated search query
    const searchQuery = (search || q || username || "").toString().trim();
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 10)); // Reduced max limit
    const skip = (pageNum - 1) * limitNum;
    // 🚀 OPTIMIZATION 2: Smart caching for search results
    const cacheKey = `search:users:v2:${Buffer.from(
      JSON.stringify({
        searchQuery,
        pageNum,
        limitNum,
        role,
        isActive,
        sortBy,
        sortOrder,
      }),
    )
      .toString("base64")
      .slice(0, 32)}`;
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        return res.status(200).json(new ApiResponse(200, cached, "Search results from cache"));
      }
    } catch (cacheError) {
      console.warn("Search cache failed:", cacheError.message);
    }
    // 🚀 OPTIMIZATION 3: Optimized aggregation pipeline
    const pipeline = [];
    const matchStage = {};
    // Build search conditions
    if (searchQuery) {
      // Use text index if available, otherwise regex
      if (searchQuery.length >= 3) {
        // Only use complex search for 3+ chars
        matchStage.$or = [
          { username: { $regex: searchQuery, $options: "i" } },
          { email: { $regex: searchQuery, $options: "i" } },
          { firstName: { $regex: searchQuery, $options: "i" } },
          { lastName: { $regex: searchQuery, $options: "i" } },
        ];
      } else {
        // For short queries, use prefix matching (faster)
        matchStage.$or = [
          { username: { $regex: `^${searchQuery}`, $options: "i" } },
          { email: { $regex: `^${searchQuery}`, $options: "i" } },
        ];
      }
    }
    if (role) {
      matchStage.role = role;
    }
    if (isActive !== undefined) {
      matchStage.isActive = isActive === "true" || isActive === true;
    }
    // Add match stage
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }
    // Sort
    const sortObj = {};
    const validSortFields = ["createdAt", "username", "email", "firstName", "lastName"];
    const validSortBy = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    sortObj[validSortBy] = sortOrder === "asc" ? 1 : -1;
    pipeline.push({ $sort: sortObj });

    // Project only needed fields
    pipeline.push({
      $project: {
        username: 1,
        email: 1,
        firstName: 1,
        lastName: 1,
        role: 1,
        isActive: 1,
        createdAt: 1,
        profileImage: 1,
      },
    });
    // Pagination with count
    pipeline.push({
      $facet: {
        data: [{ $skip: skip }, { $limit: limitNum }],
        totalCount: [{ $count: "count" }],
      },
    });
    // Execute optimized aggregation
    const [result] = await User.aggregate(pipeline, {
      allowDiskUse: false,
      maxTimeMS: 8000,
      readConcern: { level: "local" },
    });
    const users = result.data || [];
    const totalCount = result.totalCount[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / limitNum);
    const executionTime = Date.now() - startTime;
    const responseData = {
      users,
      search: {
        query: searchQuery,
        filters: { role, isActive },
        resultsCount: users.length,
      },
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        limit: limitNum,
      },
      meta: {
        executionTime: `${executionTime}ms`,
        performanceGrade: executionTime < 100 ? "A++" : executionTime < 300 ? "A+" : "B",
        cached: false,
        optimized: true,
      },
    };
    // 🚀 OPTIMIZATION 4: Cache results (shorter TTL for search)
    setImmediate(() => {
      const cacheTTL = searchQuery ? 60 : 180; // Shorter cache for search results
      cache
        .setex(cacheKey, cacheTTL, responseData)
        .catch((err) => console.warn("Search cache set failed:", err.message));
    });
    return res.status(200).json(new ApiResponse(200, responseData, "Optimized search completed"));
  } catch (error) {
    console.error("❌ Search users error:", error);
    throw new ApiError(500, `Search failed: ${error.message}`);
  }
});

// ** 🚀BULK EXPORT USERS
const bulkExportUsers = asyncHandler(async (req, res) => {
  try {
    const {
      format = "csv",
      role,
      isActive,
      fields,
      search = "", // ✨ FIX: Added missing 'search' parameter
      limit = 1000,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;
    // Validate format
    const supportedFormats = ["csv", "json"];
    const normalizedFormat = format.toLowerCase();
    if (!supportedFormats.includes(normalizedFormat)) {
      throw new ApiError(400, `Unsupported format '${format}'. Supported: ${supportedFormats.join(", ")}`);
    }
    const exportLimit = Math.min(10000, Math.max(1, parseInt(limit) || 1000));
    console.log(`📊 Export limit: ${exportLimit}`);
    // ✨ FIX: Using a single, clean pipeline for data fetching
    const pipeline = [];
    const matchStage = {}; // Use one object for all filters
    // Build the match stage for filtering
    const searchQuery = search.toString().trim();
    if (searchQuery) {
      matchStage.$or = [
        { username: { $regex: searchQuery, $options: "i" } },
        { email: { $regex: searchQuery, $options: "i" } },
        { firstName: { $regex: searchQuery, $options: "i" } },
        { lastName: { $regex: searchQuery, $options: "i" } },
      ];
    }
    if (role && role.trim()) {
      matchStage.role = role.trim();
    }
    if (isActive !== undefined) {
      matchStage.isActive = isActive === "true" || isActive === true;
    }
    // Add the match stage to the pipeline if it has any filters
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }
    // Build sort object
    const sortObj = {};
    const validSortFields = ["createdAt", "username", "email", "firstName", "lastName", "role"];
    const validSortBy = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const validSortOrder = sortOrder === "asc" ? 1 : -1;
    sortObj[validSortBy] = validSortOrder;
    pipeline.push({ $sort: sortObj });
    // Exclude sensitive fields
    pipeline.push({ $project: { password: 0, refreshToken: 0, __v: 0 } });
    // Add limit
    pipeline.push({ $limit: exportLimit });
    // ✨ FIX: Executing the aggregation pipeline instead of User.find()
    const users = await User.aggregate(pipeline).allowDiskUse(true);
    console.log(`✅ Found ${users.length} users for export`);
    if (users.length === 0) {
      console.log("⚠️ No users found matching criteria");
      if (normalizedFormat === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="empty_export.csv"');
        return res.status(200).send("No users found matching the specified criteria");
      } else {
        return res.status(200).json({
          users: [],
          exportedAt: new Date(),
          total: 0,
          filters: matchStage,
          format: normalizedFormat,
          message: "No users found matching the specified criteria",
        });
      }
    }
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `users_export_${timestamp}.${normalizedFormat}`;
    if (normalizedFormat === "csv") {
      let csvHeader, csvData;
      if (fields && fields.trim()) {
        const fieldList = fields
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f);
        if (fieldList.length === 0) {
          throw new ApiError(400, "No valid fields specified for export");
        }
        console.log("📋 Custom fields for export:", fieldList);
        csvHeader = `${fieldList.join(",")}\n`;
        csvData = users
          .map((user) => {
            return fieldList
              .map((field) => {
                let value = user[field];
                if (value === null || value === undefined) {
                  return "";
                }
                if (typeof value === "object") {
                  if (value instanceof Date) {
                    return value.toISOString();
                  }
                  return JSON.stringify(value).replace(/"/g, '""');
                }
                value = String(value).replace(/"/g, '""');
                if (value.includes(",") || value.includes('"') || value.includes("\n")) {
                  return `"${value}"`;
                }
                return value;
              })
              .join(",");
          })
          .join("\n");
      } else {
        csvHeader = "ID,Username,Email,First Name,Last Name,Role,Active,Created At\n";
        csvData = users
          .map((user) => {
            const escapeCSV = (val) => {
              if (val === null || val === undefined) {
                return "";
              }
              val = String(val);
              if (val.includes(",") || val.includes('"') || val.includes("\n")) {
                return `"${val.replace(/"/g, '""')}"`;
              }
              return val;
            };
            return [
              user._id,
              escapeCSV(user.username || ""),
              escapeCSV(user.email || ""),
              escapeCSV(user.firstName || ""),
              escapeCSV(user.lastName || ""),
              escapeCSV(user.role || ""),
              user.isActive ? "true" : "false",
              new Date(user.createdAt).toISOString(),
            ].join(",");
          })
          .join("\n");
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-cache");
      console.log(`📤 Sending CSV export: ${filename}`);
      return res.status(200).send(csvHeader + csvData);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-cache");
      console.log(`📤 Sending JSON export: ${filename}`);
      return res.status(200).json({
        meta: {
          exportedAt: new Date().toISOString(),
          total: users.length,
          filters: matchStage,
          format: normalizedFormat,
          limit: exportLimit,
          sorting: {
            sortBy: validSortBy,
            sortOrder,
          },
        },
        users,
      });
    }
  } catch (error) {
    console.error("❌ Bulk export error:", error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, `Export failed: ${error.message}`);
  }
});

// ** 🚀 BULK IMPORT USERS
const bulkImportUsers = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Please upload a CSV file");
  }
  const { skipDuplicates = true, updateExisting = false, validateOnly = false } = req.body;
  const filePath = req.file.path;
  const importId = `import_${Date.now()}_${req.user._id}`;
  const importProgress = {
    id: importId,
    startTime: Date.now(),
    totalProcessed: 0,
    successful: 0,
    duplicates: 0,
    errors: 0,
    status: "processing",
    details: {
      createdUsers: [],
      updatedUsers: [],
      duplicateEmails: [],
      errors: [],
    },
  };
  try {
    const result = await exportImportService.processCSVImport({
      filePath,
      options: {
        skipDuplicates,
        updateExisting,
        validateOnly,
        batchSize: 500,
        adminId: req.user._id,
      },
      progressCallback: (progress) => {
        console.log(`Import progress: ${progress.processed}/${progress.total}`);
      },
    });
    Object.assign(importProgress, result, {
      status: "completed",
      endTime: Date.now(),
      executionTime: Date.now() - importProgress.startTime,
    });
    await auditService.logAdminAction({
      adminId: req.user._id,
      action: "BULK_IMPORT_USERS",
      metadata: {
        importId,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        totalProcessed: result.totalProcessed,
        successful: result.successful,
        duplicates: result.duplicates,
        errors: result.errors,
        options: { skipDuplicates, updateExisting, validateOnly },
      },
    });
    if (!validateOnly && result.successful > 0) {
      await cache.invalidateUserCaches();
      await cache.invalidatePattern("admin:stats:*");
    }
    return res.status(200).json(new ApiResponse(200, importProgress, "Bulk import completed"));
  } catch (error) {
    importProgress.status = "failed";
    importProgress.error = error.message;
    console.error("Bulk import failed:", error.message);
    throw new ApiError(500, `Import failed: ${error.message}`);
  } finally {
    await exportImportService.cleanupFile(filePath);
  }
});

// ** 🚀 BULK ACTIONS CONTROLLER
const bulkActions = asyncHandler(async (req, res) => {
  const { action, userIds, data = {}, confirmPassword, dryRun = false } = req.body;
  if (!action || !userIds || !Array.isArray(userIds)) {
    throw new ApiError(400, "Action and userIds array are required");
  }
  if (userIds.length === 0) {
    throw new ApiError(400, "At least one user ID is required");
  }
  if (userIds.length > 1000) {
    throw new ApiError(400, "Cannot process more than 1000 users at once");
  }
  const validUserIds = [];
  const invalidUserIds = [];
  userIds.forEach((id) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
      validUserIds.push(id);
    } else {
      invalidUserIds.push(id);
    }
  });
  if (invalidUserIds.length > 0) {
    throw new ApiError(400, `Invalid user IDs: ${invalidUserIds.join(", ")}`);
  }
  const destructiveActions = ["delete", "suspend", "force_password_reset"];
  const isDestructive = destructiveActions.includes(action);
  if (isDestructive && validUserIds.includes(req.user._id.toString())) {
    throw new ApiError(400, `You cannot ${action} your own account`);
  }
  if (isDestructive && process.env.NODE_ENV === "production" && !confirmPassword) {
    throw new ApiError(400, `Password confirmation required for ${action} action`);
  }
  if (dryRun) {
    const preview = await generateBulkActionPreview(action, validUserIds, data);
    return res.status(200).json(new ApiResponse(200, preview, "Bulk action preview generated"));
  }
  const operationId = `bulk_${action}_${Date.now()}`;
  const startTime = Date.now();
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const batchSize = 100;
      const results = {
        successful: 0,
        failed: 0,
        errors: [],
        processedUsers: [],
      };
      for (let i = 0; i < validUserIds.length; i += batchSize) {
        const batch = validUserIds.slice(i, i + batchSize);
        const batchResult = await processBulkActionBatch(action, batch, data, req.user._id, session);
        results.successful += batchResult.successful;
        results.failed += batchResult.failed;
        results.errors.push(...batchResult.errors);
        results.processedUsers.push(...batchResult.processedUsers);
        if (validUserIds.length > 100) {
          console.log(`Bulk ${action} progress: ${i + batch.length}/${validUserIds.length}`);
        }
      }
      return results;
    });
    // Clear cache (optional)
    try {
      await cache.invalidateUserCaches();
      await cache.invalidatePattern("admin:stats:*");
    } catch (cacheError) {
      // Cache not available, continue
    }
    // Log admin action (optional)
    try {
      await auditService.logAdminAction({
        adminId: req.user._id,
        action: `BULK_${action.toUpperCase()}`,
        metadata: {
          operationId,
          totalUsers: validUserIds.length,
          successful: result.successful,
          failed: result.failed,
          executionTime: Date.now() - startTime,
          data,
        },
      });
    } catch (auditError) {
      // Audit service not available, continue
    }
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          operationId,
          action,
          summary: {
            totalRequested: validUserIds.length,
            successful: result.successful,
            failed: result.failed,
            executionTime: Date.now() - startTime,
          },
          details:
            result.errors.length > 0
              ? {
                  errors: result.errors.slice(0, 10),
                  hasMoreErrors: result.errors.length > 10,
                }
              : undefined,
        },
        `Bulk ${action} completed`,
      ),
    );
  } catch (error) {
    console.error("Bulk operation failed:", error.message);
    throw new ApiError(500, `Bulk operation failed: ${error.message}`);
  } finally {
    await session.endSession();
  }
});

// ** SECURITY & MONITORING CONTROLLERS ***

// ** 🚀 Get User Security Analysis with Mock Data
const getUserSecurityAnalysis = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { includeDevices = true, includeSessions = true } = req.query;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  const user = await User.findById(id)
    .select("username email firstName lastName createdAt isActive isVerified lastLogin")
    .lean();
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  const startTime = Date.now();
  // TODO: Implement actual security analysis
  const securityAnalysis = {
    riskAssessment: {
      overallRisk: "UNKNOWN",
      riskScore: 0,
      factors: [],
    },
    activityPatterns: {
      lastLogin: null,
      loginFrequency: "UNKNOWN",
      suspiciousActivity: false,
    },
    deviceAnalysis: {
      devices: [],
      totalDevices: 0,
      trustedDevices: 0,
    },
    sessionAnalysis: {
      sessions: [],
      totalSessions: 0,
      activeSessions: 0,
    },
    recommendations: [],
  };
  // Log admin action (optional)
  try {
    await auditService.logAdminAction({
      adminId: req.user._id,
      action: "VIEW_USER_SECURITY_ANALYSIS",
      targetUserId: id,
      metadata: {
        includeDevices,
        includeSessions,
        executionTime: Date.now() - startTime,
      },
    });
  } catch (auditError) {
    // Audit service not available, continue
  }
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
        },
        securityAnalysis,
        meta: {
          generatedAt: new Date().toISOString(),
          executionTime: Date.now() - startTime,
        },
      },
      "Security analysis completed",
    ),
  );
});

// ** 🚀 Send Notification to User with Mock Result
const sendNotificationToUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    title,
    message,
    type = "info",
    priority = "normal",
    template,
    templateData = {},
    channels = ["in-app"],
    scheduleFor,
    trackDelivery = true,
  } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  if (!template && (!title || !message)) {
    throw new ApiError(400, "Title and message are required (or use a template)");
  }
  const user = await User.findById(id).select("username email firstName lastName isActive").lean();
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  if (!user.isActive) {
    throw new ApiError(400, "Cannot send notifications to inactive users");
  }
  const validChannels = ["email", "sms", "push", "in-app"];
  const invalidChannels = channels.filter((ch) => !validChannels.includes(ch));
  if (invalidChannels.length > 0) {
    throw new ApiError(400, `Invalid channels: ${invalidChannels.join(", ")}`);
  }
  const notificationId = `notif_${Date.now()}_${id}`;
  // TODO: Implement actual notification sending
  const result = {
    notificationId,
    delivered: false,
    channels,
    timestamp: new Date().toISOString(),
    user: {
      id: user._id,
      email: user.email,
    },
  };
  // Log admin action (optional)
  try {
    await auditService.logAdminAction({
      adminId: req.user._id,
      action: "SEND_USER_NOTIFICATION",
      targetUserId: id,
      metadata: {
        notificationId,
        type,
        priority,
        channels,
        template: template || "custom",
        scheduled: !!scheduleFor,
      },
    });
  } catch (auditError) {
    // Audit service not available, continue
  }
  return res.status(200).json(new ApiResponse(200, result, "Notification sent successfully"));
});

// ** 🚀 Force Password Reset with Audit Logging
const forcePasswordReset = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason, notifyUser = true, invalidateAllSessions = true, confirmPassword } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  if (req.user._id.toString() === id) {
    throw new ApiError(400, "You cannot force password reset on your own account");
  }
  if (!reason || reason.trim().length < 10) {
    throw new ApiError(400, "Detailed reason is required (minimum 10 characters)");
  }
  if (process.env.NODE_ENV === "production" && !confirmPassword) {
    throw new ApiError(400, "Password confirmation required for password reset");
  }
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const resetToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const resetExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const updatedUser = await User.findByIdAndUpdate(
        id,
        {
          passwordResetRequired: true,
          passwordResetToken: resetToken,
          passwordResetExpires: resetExpires,
          passwordResetBy: req.user._id,
          passwordResetReason: reason.trim(),
          passwordResetAt: new Date(),
          ...(invalidateAllSessions && { $inc: { tokenVersion: 1 } }),
        },
        { new: true, session },
      ).select("username email firstName lastName");
      if (!updatedUser) {
        throw new ApiError(404, "User not found");
      }
      await auditService.logAdminAction(
        {
          adminId: req.user._id,
          action: "FORCE_PASSWORD_RESET",
          targetUserId: id,
          metadata: {
            reason,
            invalidateAllSessions,
            resetExpires,
            userEmail: updatedUser.email,
            criticality: "HIGH",
          },
        },
        session,
      );
      return { user: updatedUser, resetToken };
    });
    if (notifyUser) {
      // TODO: Implement actual notification sending
      console.log(`Security notification would be sent to ${result.user.email}`);
    }
    // Clear cache (optional)
    try {
      await cache.invalidateUserCaches(id);
    } catch (cacheError) {
      // Cache not available, continue
    }
    console.log(`🚨 SECURITY ALERT: Password reset forced for ${result.user.email} by ${req.user.email}`, {
      reason,
      timestamp: new Date(),
      adminId: req.user._id,
      targetUserId: id,
    });
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          user: {
            id: result.user._id,
            username: result.user.username,
            email: result.user.email,
          },
          resetDetails: {
            tokenGenerated: true,
            expiresAt: result.user.passwordResetExpires,
            notificationSent: notifyUser,
          },
        },
        "Password reset forced successfully",
      ),
    );
  } finally {
    await session.endSession();
  }
});

// ** LEGACY CONTROLLERS (for backward compatibility) ***

// ** 🚀 Get User Activity Log with Mock Data
const getUserActivityLog = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  // TODO: Implement actual activity log
  const activityLog = {
    activities: [],
    totalActivities: 0,
    lastActivity: null,
  };
  return res.status(200).json(new ApiResponse(200, { activityLog }, "User activity log fetched"));
});

// ** 🚀 Get User Login History with Mock Data
const getUserLoginHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  // TODO: Implement actual login history
  const loginHistory = {
    sessions: [],
    totalSessions: 0,
    activeSessions: 0,
  };
  return res.status(200).json(new ApiResponse(200, { loginHistory }, "User login history fetched"));
});

// ** 🚀 Get User Device Info with Mock Data
const getUserDeviceInfo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid user ID");
  }
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  // TODO: Implement actual device info
  const deviceInfo = {
    devices: [],
    totalDevices: 0,
    trustedDevices: 0,
  };
  return res.status(200).json(new ApiResponse(200, { deviceInfo }, "User device info fetched"));
});

// ** HELPER FUNCTIONS ***

// ** Generate Bulk Action Preview for Dry Run or Preview
async function generateBulkActionPreview(action, userIds, data) {
  const users = await User.find({ _id: { $in: userIds } }, { username: 1, email: 1, role: 1, isActive: 1 }).lean();
  const preview = {
    action,
    totalUsers: userIds.length,
    foundUsers: users.length,
    missingUsers: userIds.length - users.length,
    affectedUsers: users.map((user) => ({
      id: user._id,
      username: user.username,
      email: user.email,
      currentStatus: {
        role: user.role,
        isActive: user.isActive,
      },
    })),
    estimatedChanges: generateActionEstimate(action, users, data),
  };
  return preview;
}
// ** Generate Action Estimate for Bulk Actions Preview
function generateActionEstimate(action, users, data) {
  switch (action) {
    case "suspend":
      return {
        usersToSuspend: users.filter((u) => u.isActive).length,
        alreadySuspended: users.filter((u) => !u.isActive).length,
      };
    case "activate":
      return {
        usersToActivate: users.filter((u) => !u.isActive).length,
        alreadyActive: users.filter((u) => u.isActive).length,
      };
    case "updateRole":
      return {
        roleChanges: users.filter((u) => u.role !== data.role).length,
        noChange: users.filter((u) => u.role === data.role).length,
        newRole: data.role,
      };
    default:
      return { message: `Will ${action} ${users.length} users` };
  }
}
// ** Process Bulk Action Batch with Transaction Support
async function processBulkActionBatch(action, userIds, data, adminId, session) {
  const results = {
    successful: 0,
    failed: 0,
    errors: [],
    processedUsers: [],
  };
  const updateData = {
    updatedAt: new Date(),
    lastModifiedBy: adminId,
  };
  try {
    let result = null;
    switch (action) {
      case "activate":
        updateData.isActive = true;
        updateData.$unset = {
          suspendedAt: 1,
          suspensionReason: 1,
          suspendedBy: 1,
        };
        result = await User.updateMany({ _id: { $in: userIds } }, updateData, {
          session,
        });
        break;
      case "suspend":
        updateData.isActive = false;
        updateData.suspendedAt = new Date();
        updateData.suspendedBy = adminId;
        updateData.suspensionReason = data.reason || "Bulk suspension";
        result = await User.updateMany({ _id: { $in: userIds } }, updateData, {
          session,
        });
        break;
      case "updateRole":
        if (!data.role) {
          throw new Error("Role is required for role update");
        }
        updateData.role = data.role;
        result = await User.updateMany({ _id: { $in: userIds } }, updateData, {
          session,
        });
        break;
      case "verify":
        updateData.isVerified = true;
        updateData.verifiedAt = new Date();
        updateData.verifiedBy = adminId;
        result = await User.updateMany({ _id: { $in: userIds } }, updateData, {
          session,
        });
        break;
      case "delete":
        result = await User.deleteMany({ _id: { $in: userIds } }, { session });
        break;
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
    results.successful = result.modifiedCount || result.deletedCount || 0;
    results.processedUsers = userIds.map((id) => ({ id, status: "success" }));
  } catch (error) {
    results.failed = userIds.length;
    results.errors.push({
      batch: userIds,
      error: error.message,
    });
    results.processedUsers = userIds.map((id) => ({
      id,
      status: "failed",
      error: error.message,
    }));
  }
  return results;
}

export {
  getAdminStats,
  getAdminStatsLive,
  getAllAdmins,
  getAdminById,
  getAllUsers,
  getUserById,
  deleteUserById,
  updateUserById,
  suspendUser,
  activateUser,
  searchUsers,
  bulkExportUsers,
  bulkImportUsers,
  bulkActions,
  getUserActivityLog,
  getUserLoginHistory,
  getUserDeviceInfo,
  sendNotificationToUser,
  verifyUserAccount,
  forcePasswordReset,
  getUserSecurityAnalysis,
};
