// src/modules/admin/controllers/session.controller.js
import { ApiError } from "../../../shared/utils/ApiError.js";
import { ApiResponse } from "../../../shared/utils/ApiResponse.js";
import { asyncHandler } from "../../../shared/utils/AsyncHandler.js";
import { SessionService } from "../../../shared/services/session.service.js";
import { CacheService } from "../../../shared/services/cache.service.js";
import e from "express";

const sessionService = new SessionService();
const cache = new CacheService();

/**
 * Get admin session analytics with detailed tracking
 * @route GET /admin/sessions/analytics
 * @access Admin, Super Admin
 */
const getAdminSessionAnalytics = asyncHandler(async (req, res) => {
  const startTime = process.hrtime.bigint();
  const { adminId, timeRange = "30d" } = req.query;
  const cacheKey = `admin:sessions:analytics:${adminId || "all"}:${timeRange}`;

  // Try cache first
  const cached = await cache.get(cacheKey);
  if (cached) {
    const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          ...cached,
          metadata: {
            ...cached.metadata,
            generatedAt: new Date().toISOString(),
            fromCache: true,
          },
          meta: {
            cacheHit: true,
            generatedAt: new Date().toISOString(),
            executionTime: `${responseTime.toFixed(2)}ms`,
            performanceGrade: "A++",
            dataFreshness: "cached_5m",
          },
        },
        "Admin session analytics from cache",
      ),
    );
  }
  // Get session analytics
  const sessionAnalytics = await sessionService.getAdminSessionAnalytics(adminId);
  const engagement = await sessionService.getAdminEngagementAnalytics();
  const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
  const response = {
    sessions: sessionAnalytics,
    engagement,
    summary: {
      totalAdmins: sessionAnalytics.length,
      activeSessions: sessionAnalytics.reduce((sum, admin) => sum + admin.activeSessions, 0),
      totalSessions: sessionAnalytics.reduce((sum, admin) => sum + admin.totalSessions, 0),
      avgSessionDuration: Math.round(
        sessionAnalytics.reduce((sum, admin) => sum + (admin.avgDuration || 0), 0) /
          Math.max(sessionAnalytics.length, 1),
      ),
      uniqueRegions: [...new Set(sessionAnalytics.flatMap((admin) => admin.regions))].length,
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      fromCache: false,
      optimizedVersion: "v3.0-Production",
      pipeline: "single_facet_aggregation",
    },
    meta: {
      cacheHit: false,
      generatedAt: new Date().toISOString(),
      executionTime: `${executionTime.toFixed(2)}ms`,
      performanceGrade: executionTime < 50 ? "A++" : executionTime < 100 ? "A+" : "A",
      dataFreshness: "real_time",
      optimizations: ["single_facet_pipeline", "optimized_date_calculations", "smart_caching", "timeout_protection"],
    },
  };
  // Cache for 5 minutes
  await cache.set(cacheKey, response, 300);
  return res.status(200).json(new ApiResponse(200, response, "Admin session analytics generated"));
});

/**
 * Get specific admin session details
 * @route GET /admin/sessions/:adminId
 * @access Admin, Super Admin
 */
const getAdminSessionDetails = asyncHandler(async (req, res) => {
  const startTime = process.hrtime.bigint();
  const { adminId } = req.params;
  const { limit = 20, page = 1 } = req.query;

  if (!adminId) {
    throw new ApiError(400, "Admin ID is required");
  }
  const sessionDetails = await sessionService.getAdminSessionAnalytics(adminId);
  const executionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
  if (!sessionDetails.length) {
    // Return empty session data instead of error
    const response = {
      admin: {
        userId: adminId,
        username: "Unknown",
        email: "Unknown",
        role: "admin",
      },
      sessionStats: {
        totalSessions: 0,
        activeSessions: 0,
        lastLogin: null,
        avgDuration: 0,
        uniqueIPCount: 0,
        deviceCount: 0,
        browserCount: 0,
        regionCount: 0,
      },
      details: {
        uniqueIPs: [],
        devices: [],
        browsers: [],
        regions: [],
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        fromCache: false,
        optimizedVersion: "v3.0-Production",
        pipeline: "single_facet_aggregation",
      },
      meta: {
        cacheHit: false,
        generatedAt: new Date().toISOString(),
        executionTime: `${executionTime.toFixed(2)}ms`,
        performanceGrade: "A++",
        dataFreshness: "real_time",
        warning: "No session data found - admin has not logged in yet",
      },
    };
    return res.status(200).json(new ApiResponse(200, response, "Admin has no session data - not logged in yet"));
  }

  const admin = sessionDetails[0];
  const response = {
    admin: {
      userId: admin.userId,
      username: admin.username,
      email: admin.email,
      role: admin.role,
    },
    sessionStats: {
      totalSessions: admin.totalSessions,
      activeSessions: admin.activeSessions,
      lastLogin: admin.lastLogin,
      avgDuration: admin.avgDuration,
      uniqueIPCount: admin.uniqueIPCount,
      deviceCount: admin.deviceCount,
      browserCount: admin.browserCount,
      regionCount: admin.regionCount,
    },
    details: {
      uniqueIPs: admin.uniqueIPs,
      devices: admin.devices,
      browsers: admin.browsers,
      regions: admin.regions,
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      fromCache: false,
      optimizedVersion: "v3.0-Production",
      pipeline: "single_facet_aggregation",
    },
    meta: {
      cacheHit: false,
      generatedAt: new Date().toISOString(),
      executionTime: `${executionTime.toFixed(2)}ms`,
      performanceGrade: executionTime < 50 ? "A++" : executionTime < 100 ? "A+" : "A",
      dataFreshness: "real_time",
      optimizations: ["single_facet_pipeline", "optimized_date_calculations", "smart_caching", "timeout_protection"],
    },
  };
  return res.status(200).json(new ApiResponse(200, response, "Admin session details retrieved"));
});

export { getAdminSessionAnalytics, getAdminSessionDetails };
