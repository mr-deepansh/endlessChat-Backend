// src/modules/admin/controllers/dashboard.controller.js
import { User } from "../../users/models/user.model.js";
import { ApiError } from "../../../shared/utils/ApiError.js";
import { ApiResponse } from "../../../shared/utils/ApiResponse.js";
import { asyncHandler } from "../../../shared/utils/AsyncHandler.js";
import { SessionService } from "../../../shared/services/session.service.js";
import { CacheService } from "../../../shared/services/cache.service.js";
import { MetricsCollector } from "../../../shared/services/metrics.service.js";
import { Logger } from "../../../shared/utils/Logger.js";
import { calculateApiHealth } from "../../../shared/utils/ApiHealth.js";
import { safeAsyncOperation, handleControllerError } from "../../../shared/utils/ErrorHandler.js";

// Configuration constants
const CACHE_CONFIG = {
  TIME_BUCKET_SECONDS: 30,
  DEFAULT_TTL: 30,
  FALLBACK_TTL: 300,
  VERSION: "v5",
};

const PERFORMANCE_THRESHOLDS = {
  EXCELLENT: 50,
  GOOD: 100,
  ACCEPTABLE: 200,
};

const QUERY_CONFIG = {
  MAX_TIME_MS: 10000,
  MONTHLY_LOOKBACK_MONTHS: 6,
  RECENT_USERS_LIMIT: 10,
};

// Initialize services
const sessionService = new SessionService();
const cache = new CacheService();
const metrics = new MetricsCollector();
const logger = new Logger("AdminDashboard");

/**
 * Dashboard data validator
 */
class DashboardValidator {
  static validateAggregationResult(result) {
    if (!result) {
      throw new ApiError(404, "No aggregation data found");
    }

    const { basicCounts, roleDistribution, recentUsers, monthlyGrowth } = result;

    // Validate basic counts
    if (!Array.isArray(basicCounts) || basicCounts.length === 0) {
      throw new ApiError(500, "Invalid basic counts structure");
    }

    const counts = basicCounts[0];
    const requiredCountFields = ["totalUsers", "activeUsers", "adminUsers", "superAdminUsers"];

    for (const field of requiredCountFields) {
      if (typeof counts[field] !== "number") {
        throw new ApiError(500, `Invalid or missing ${field} in basic counts`);
      }
    }

    // Validate role distribution
    if (!Array.isArray(roleDistribution)) {
      throw new ApiError(500, "Invalid role distribution structure");
    }

    // Validate recent users
    if (!Array.isArray(recentUsers)) {
      throw new ApiError(500, "Invalid recent users structure");
    }

    // Validate monthly growth
    if (!Array.isArray(monthlyGrowth)) {
      throw new ApiError(500, "Invalid monthly growth structure");
    }

    return true;
  }

  static validateEngagementData(engagement) {
    if (!engagement || typeof engagement !== "object") {
      return {
        activeSessions: 0,
        sessionDuration: { average: 0, min: 0, max: 0, total: 0 },
        userActivity: { highly_active: 0, moderately_active: 0, low_active: 0 },
      };
    }

    // Ensure all required fields exist with defaults
    return {
      activeSessions: engagement.activeSessions || 0,
      sessionDuration: engagement.sessionDuration || {
        average: 0,
        min: 0,
        max: 0,
        total: 0,
      },
      userActivity: engagement.userActivity || {
        highly_active: 0,
        moderately_active: 0,
        low_active: 0,
      },
    };
  }
}

/**
 * Dashboard data processor
 */
class DashboardProcessor {
  static buildAggregationPipeline() {
    const monthsAgo = new Date(Date.now() - QUERY_CONFIG.MONTHLY_LOOKBACK_MONTHS * 30 * 24 * 60 * 60 * 1000);

    return [
      {
        $facet: {
          // Basic user statistics
          basicCounts: [
            {
              $group: {
                _id: null,
                totalUsers: { $sum: 1 },
                activeUsers: { $sum: { $cond: ["$isActive", 1, 0] } },
                adminUsers: {
                  $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] },
                },
                superAdminUsers: {
                  $sum: { $cond: [{ $eq: ["$role", "super_admin"] }, 1, 0] },
                },
                verifiedUsers: { $sum: { $cond: ["$isVerified", 1, 0] } },
                avgLoginFrequency: { $avg: "$loginCount" },
              },
            },
          ],

          // Role-based distribution
          roleDistribution: [
            {
              $group: {
                _id: "$role",
                count: { $sum: 1 },
                activeCount: { $sum: { $cond: ["$isActive", 1, 0] } },
              },
            },
            { $sort: { count: -1 } },
          ],

          // Recent user registrations
          recentUsers: [
            { $sort: { createdAt: -1 } },
            { $limit: QUERY_CONFIG.RECENT_USERS_LIMIT },
            {
              $project: {
                _id: 1,
                username: 1,
                email: 1,
                role: 1,
                createdAt: 1,
                isActive: 1,
                isVerified: 1,
                lastLoginAt: 1,
              },
            },
          ],

          // Monthly growth trend
          monthlyGrowth: [
            { $match: { createdAt: { $gte: monthsAgo } } },
            {
              $group: {
                _id: {
                  year: { $year: "$createdAt" },
                  month: { $month: "$createdAt" },
                },
                newUsers: { $sum: 1 },
                activeUsers: { $sum: { $cond: ["$isActive", 1, 0] } },
              },
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
            { $limit: QUERY_CONFIG.MONTHLY_LOOKBACK_MONTHS },
          ],

          // User activity patterns
          activityPatterns: [
            { $match: { lastLoginAt: { $exists: true } } },
            {
              $group: {
                _id: {
                  $cond: [
                    {
                      $gte: ["$lastLoginAt", new Date(Date.now() - 24 * 60 * 60 * 1000)],
                    },
                    "today",
                    {
                      $cond: [
                        {
                          $gte: ["$lastLoginAt", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)],
                        },
                        "this_week",
                        {
                          $cond: [
                            {
                              $gte: ["$lastLoginAt", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)],
                            },
                            "this_month",
                            "older",
                          ],
                        },
                      ],
                    },
                  ],
                },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ];
  }

  static processAggregationResults(result) {
    const {
      basicCounts = [{}],
      roleDistribution = [],
      recentUsers = [],
      monthlyGrowth = [],
      activityPatterns = [],
    } = result;
    const counts = basicCounts[0] || {};
    const {
      totalUsers = 0,
      activeUsers = 0,
      adminUsers = 0,
      superAdminUsers = 0,
      verifiedUsers = 0,
      avgLoginFrequency = 0,
    } = counts;
    return {
      overview: {
        totalUsers,
        activeUsers,
        adminUsers,
        superAdminUsers,
        verifiedUsers,
        suspendedUsers: totalUsers - activeUsers,
        activePercentage: totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : "0.0",
        verificationRate: totalUsers > 0 ? ((verifiedUsers / totalUsers) * 100).toFixed(1) : "0.0",
        healthScore: Math.round((activeUsers / Math.max(totalUsers, 1)) * 100),
        avgLoginFrequency: Math.round(avgLoginFrequency || 0),
      },
      breakdown: {
        usersByRole: Object.fromEntries(
          roleDistribution.map((item) => [
            item._id || "undefined",
            { total: item.count, active: item.activeCount || 0 },
          ]),
        ),
        monthlyGrowth: this.formatMonthlyGrowth(monthlyGrowth),
        activityDistribution: Object.fromEntries(activityPatterns.map((item) => [item._id, item.count])),
      },
      activity: {
        recentUsers: this.formatRecentUsers(recentUsers),
      },
    };
  }
  static formatMonthlyGrowth(monthlyGrowth) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return monthlyGrowth.map((item) => ({
      year: item._id.year,
      month: item._id.month,
      monthName: monthNames[item._id.month - 1],
      newUsers: item.newUsers,
      activeUsers: item.activeUsers,
      growthRate: item.newUsers > 0 ? ((item.activeUsers / item.newUsers) * 100).toFixed(1) : "0.0",
    }));
  }
  static formatRecentUsers(recentUsers) {
    return recentUsers.map((user) => ({
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      joinedAt: user.createdAt,
      lastLogin: user.lastLoginAt,
      status: user.isActive ? "active" : "suspended",
      verified: user.isVerified || false,
      daysSinceJoined: Math.floor((Date.now() - new Date(user.createdAt)) / (24 * 60 * 60 * 1000)),
      daysSinceLogin: user.lastLoginAt
        ? Math.floor((Date.now() - new Date(user.lastLoginAt)) / (24 * 60 * 60 * 1000))
        : null,
    }));
  }
  static calculatePerformanceGrade(executionTime) {
    if (executionTime < PERFORMANCE_THRESHOLDS.EXCELLENT) {
      return "A++";
    }
    if (executionTime < PERFORMANCE_THRESHOLDS.GOOD) {
      return "A+";
    }
    if (executionTime < PERFORMANCE_THRESHOLDS.ACCEPTABLE) {
      return "A";
    }
    return "B";
  }
}

/**
 * Cache manager for dashboard data
 */
class DashboardCacheManager {
  static generateCacheKey() {
    const timeSlot = Math.floor(Date.now() / (CACHE_CONFIG.TIME_BUCKET_SECONDS * 1000));
    return `admin:dashboard:${CACHE_CONFIG.VERSION}:${timeSlot}`;
  }
  static generateFallbackKey() {
    return `admin:dashboard:fallback:${CACHE_CONFIG.VERSION}`;
  }
  static async getCachedDashboard() {
    const cacheKey = this.generateCacheKey();
    return await cache.get(cacheKey);
  }
  static async setCachedDashboard(dashboard) {
    const cacheKey = this.generateCacheKey();
    const fallbackKey = this.generateFallbackKey();
    // Set both current cache and fallback
    await Promise.all([
      cache.set(cacheKey, dashboard, CACHE_CONFIG.DEFAULT_TTL),
      cache.set(fallbackKey, dashboard, CACHE_CONFIG.FALLBACK_TTL),
    ]);
  }
  static async getFallbackDashboard() {
    const fallbackKey = this.generateFallbackKey();
    return await cache.get(fallbackKey);
  }
}

/**
 * Get comprehensive admin dashboard with engagement and session analytics
 * @route GET /admin/dashboard
 * @access Admin, Super Admin
 */
export const getAdminDashboard = asyncHandler(async (req, res) => {
  const startTime = process.hrtime.bigint();
  const requestId = req.headers["x-request-id"] || `req_${Date.now()}`;

  logger.info("Dashboard request initiated", { requestId });
  metrics.increment("dashboard.requests.total");

  try {
    // Check cache first
    const cachedDashboard = await DashboardCacheManager.getCachedDashboard();
    if (cachedDashboard) {
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
      metrics.increment("dashboard.cache.hits");
      metrics.timing("dashboard.response_time", responseTime);
      logger.info("Dashboard served from cache", { requestId, responseTime });
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...cachedDashboard,
            meta: {
              ...cachedDashboard.meta,
              cacheHit: true,
              requestId,
              generatedAt: new Date().toISOString(),
              executionTime: `${responseTime.toFixed(2)}ms`,
              performanceGrade: "A++",
              dataFreshness: "cached_30s",
            },
          },
          "Admin dashboard retrieved from cache",
        ),
      );
    }
    metrics.increment("dashboard.cache.misses");
    // Execute database aggregation
    const pipeline = DashboardProcessor.buildAggregationPipeline();
    const aggregationOptions = {
      allowDiskUse: false,
      maxTimeMS: QUERY_CONFIG.MAX_TIME_MS,
      readConcern: { level: "local" },
    };
    logger.debug("Executing aggregation pipeline", {
      requestId,
      pipelineStages: pipeline.length,
    });
    const [aggregationResult] = await User.aggregate(pipeline, aggregationOptions);
    // Validate aggregation results
    DashboardValidator.validateAggregationResult(aggregationResult);
    // Get engagement analytics with fallback
    let engagement;
    try {
      engagement = await sessionService.getAdminEngagementAnalytics();
    } catch (error) {
      logger.warn("Failed to get engagement analytics, using defaults", {
        error: error.message,
      });
      engagement = null;
    }
    engagement = DashboardValidator.validateEngagementData(engagement);
    // Process and format data
    const processedData = DashboardProcessor.processAggregationResults(aggregationResult);
    const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
    // Build final dashboard response
    const dashboard = {
      ...processedData,
      engagement,
      metadata: {
        generatedAt: new Date().toISOString(),
        fromCache: false,
        version: CACHE_CONFIG.VERSION,
        pipeline: "optimized_facet_aggregation",
        requestId,
      },
      meta: {
        cacheHit: false,
        requestId,
        generatedAt: new Date().toISOString(),
        executionTime: `${executionTime.toFixed(2)}ms`,
        performanceGrade: DashboardProcessor.calculatePerformanceGrade(executionTime),
        dataFreshness: "real_time",
        optimizations: [
          "single_facet_pipeline",
          "time_bucketed_caching",
          "smart_validation",
          "fallback_strategy",
          "metrics_collection",
        ],
      },
    };
    // Cache the results
    await DashboardCacheManager.setCachedDashboard(dashboard);
    // Record metrics
    metrics.timing("dashboard.generation_time", executionTime);
    metrics.increment("dashboard.generation.success");
    logger.info("Dashboard generated successfully", {
      requestId,
      executionTime: `${executionTime.toFixed(2)}ms`,
      totalUsers: processedData.overview.totalUsers,
    });
    return res.status(200).json(new ApiResponse(200, dashboard, "Admin dashboard generated successfully"));
  } catch (error) {
    const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
    logger.error("Dashboard generation failed", {
      requestId,
      error: error.message,
      executionTime,
    });
    metrics.increment("dashboard.generation.errors");

    // Enhanced fallback strategy
    const fallbackDashboard = await safeAsyncOperation(() => DashboardCacheManager.getFallbackDashboard(), null, false);

    if (fallbackDashboard) {
      logger.warn("Serving fallback dashboard", { requestId });
      metrics.increment("dashboard.fallback.served");
      return res.status(200).json(
        new ApiResponse(
          200,
          {
            ...fallbackDashboard,
            meta: {
              ...fallbackDashboard.meta,
              cacheHit: true,
              requestId,
              executionTime: `${executionTime.toFixed(2)}ms`,
              apiHealth: calculateApiHealth(executionTime),
              dataFreshness: "fallback_cache",
              warning: "Using cached data due to temporary service issue",
              suggestions: [
                "Check database connectivity",
                "Verify aggregation pipeline",
                "Try refreshing in a few moments",
              ],
            },
          },
          "Admin dashboard from fallback cache",
        ),
      );
    }

    handleControllerError(error, req, res, Date.now() - Number(startTime) / 1000000, logger);
  }
});
