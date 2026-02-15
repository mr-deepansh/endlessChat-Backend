// src/modules/auth/services/location.service.js
import { UserActivity } from "../models/userActivity.model.js";
import { cacheService } from "../../../shared/services/cache.service.js";

/**
 * Enterprise Location Tracking Service
 * Optimized for high-performance location analytics and security monitoring
 */
class LocationService {
  /**
   * Get user login locations with caching
   */
  static async getUserLoginLocations(userId, options = {}) {
    const { limit = 10, days = 90, useCache = true } = options;
    const cacheKey = `user_locations:${userId}:${limit}:${days}`;
    if (useCache) {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return cached;
      }
    }
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - parseInt(days));
    const locations = await UserActivity.aggregate([
      {
        $match: {
          userId,
          action: "login",
          success: true,
          createdAt: { $gte: dateThreshold },
        },
      },
      {
        $addFields: {
          locationKey: {
            $concat: [
              { $ifNull: ["$location.city", "Unknown"] },
              ", ",
              { $ifNull: ["$location.region", "Unknown"] },
              ", ",
              { $ifNull: ["$location.country", "Unknown"] },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$locationKey",
          location: {
            $first: {
              city: { $ifNull: ["$location.city", "Unknown"] },
              region: { $ifNull: ["$location.region", "Unknown"] },
              country: { $ifNull: ["$location.country", "Unknown"] },
              timezone: "$location.timezone",
            },
          },
          loginCount: { $sum: 1 },
          lastLogin: { $max: "$createdAt" },
          firstLogin: { $min: "$createdAt" },
          uniqueIPs: { $addToSet: "$ip" },
          devices: {
            $addToSet: {
              browser: "$device.browser",
              os: "$device.os",
              device: "$device.device",
            },
          },
        },
      },
      {
        $addFields: {
          ipCount: { $size: "$uniqueIPs" },
          deviceCount: { $size: "$devices" },
          isRecent: {
            $gte: [
              "$lastLogin",
              {
                $dateSubtract: {
                  startDate: new Date(),
                  unit: "day",
                  amount: 7,
                },
              },
            ],
          },
          riskScore: {
            $switch: {
              branches: [
                {
                  case: { $gt: [{ $size: "$uniqueIPs" }, 5] },
                  then: "high",
                },
                {
                  case: { $gt: [{ $size: "$uniqueIPs" }, 3] },
                  then: "medium",
                },
              ],
              default: "low",
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          location: 1,
          loginCount: 1,
          lastLogin: 1,
          firstLogin: 1,
          ipCount: 1,
          deviceCount: 1,
          isRecent: 1,
          riskScore: 1,
          uniqueIPs: { $slice: ["$uniqueIPs", 3] },
          devices: { $slice: ["$devices", 3] },
        },
      },
      { $sort: { lastLogin: -1 } },
      { $limit: parseInt(limit) },
    ]);
    if (useCache && locations.length > 0) {
      await cacheService.set(cacheKey, locations, 300); // 5 minutes cache
    }
    return locations;
  }

  /**
   * Get location analytics for security monitoring
   */
  static async getLocationAnalytics(userId, days = 30) {
    const cacheKey = `location_analytics:${userId}:${days}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - parseInt(days));
    const [locationStats, suspiciousActivity, timelineData] = await Promise.all([
      // Location distribution
      this._getLocationDistribution(userId, dateThreshold),
      // Suspicious activity detection
      this._getSuspiciousActivity(userId, dateThreshold),
      // Timeline data for trends
      this._getTimelineData(userId, dateThreshold),
    ]);
    const analytics = {
      locationDistribution: locationStats,
      suspiciousActivity,
      timeline: timelineData,
      summary: {
        totalCountries: locationStats.length,
        totalLogins: locationStats.reduce((sum, loc) => sum + loc.loginCount, 0),
        totalUniqueIPs: locationStats.reduce((sum, loc) => sum + loc.uniqueIPCount, 0),
        suspiciousEvents: suspiciousActivity.length,
        period: `${days} days`,
        riskLevel: this._calculateRiskLevel(suspiciousActivity),
      },
    };
    await cacheService.set(cacheKey, analytics, 600); // 10 minutes cache
    return analytics;
  }
  /**
   * Get location distribution statistics
   */
  static async _getLocationDistribution(userId, dateThreshold) {
    return UserActivity.aggregate([
      {
        $match: {
          userId,
          action: "login",
          success: true,
          createdAt: { $gte: dateThreshold },
        },
      },
      {
        $group: {
          _id: "$location.country",
          count: { $sum: 1 },
          uniqueIPs: { $addToSet: "$ip" },
          cities: { $addToSet: "$location.city" },
        },
      },
      {
        $project: {
          country: { $ifNull: ["$_id", "Unknown"] },
          loginCount: "$count",
          uniqueIPCount: { $size: "$uniqueIPs" },
          cityCount: { $size: "$cities" },
          _id: 0,
        },
      },
      { $sort: { loginCount: -1 } },
    ]);
  }
  /**
   * Detect suspicious activity patterns
   */
  static async _getSuspiciousActivity(userId, dateThreshold) {
    return UserActivity.aggregate([
      {
        $match: {
          userId,
          action: "login",
          createdAt: { $gte: dateThreshold },
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
              },
            },
            ip: "$ip",
          },
          count: { $sum: 1 },
          locations: {
            $addToSet: {
              country: "$location.country",
              city: "$location.city",
            },
          },
          failedAttempts: {
            $sum: { $cond: [{ $eq: ["$success", false] }, 1, 0] },
          },
          successfulLogins: {
            $sum: { $cond: [{ $eq: ["$success", true] }, 1, 0] },
          },
        },
      },
      {
        $addFields: {
          locationCount: { $size: "$locations" },
          suspicionScore: {
            $add: [
              { $multiply: ["$failedAttempts", 2] },
              { $cond: [{ $gt: ["$count", 10] }, 3, 0] },
              { $cond: [{ $gt: [{ $size: "$locations" }, 2] }, 4, 0] },
            ],
          },
        },
      },
      {
        $match: {
          $or: [
            { count: { $gt: 10 } },
            { failedAttempts: { $gt: 3 } },
            { locationCount: { $gt: 2 } },
            { suspicionScore: { $gt: 5 } },
          ],
        },
      },
      {
        $project: {
          date: "$_id.date",
          ip: "$_id.ip",
          totalAttempts: "$count",
          failedAttempts: 1,
          successfulLogins: 1,
          locationCount: 1,
          suspicionScore: 1,
          riskLevel: {
            $switch: {
              branches: [
                { case: { $gte: ["$suspicionScore", 10] }, then: "high" },
                { case: { $gte: ["$suspicionScore", 5] }, then: "medium" },
              ],
              default: "low",
            },
          },
          _id: 0,
        },
      },
      { $sort: { date: -1, suspicionScore: -1 } },
      { $limit: 20 },
    ]);
  }
  /**
   * Get timeline data for trend analysis
   */
  static async _getTimelineData(userId, dateThreshold) {
    return UserActivity.aggregate([
      {
        $match: {
          userId,
          action: "login",
          success: true,
          createdAt: { $gte: dateThreshold },
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
              },
            },
          },
          loginCount: { $sum: 1 },
          uniqueIPs: { $addToSet: "$ip" },
          uniqueCountries: { $addToSet: "$location.country" },
        },
      },
      {
        $project: {
          date: "$_id.date",
          loginCount: 1,
          uniqueIPCount: { $size: "$uniqueIPs" },
          uniqueCountryCount: { $size: "$uniqueCountries" },
          _id: 0,
        },
      },
      { $sort: { date: 1 } },
    ]);
  }
  /**
   * Calculate overall risk level based on suspicious activities
   */
  static _calculateRiskLevel(suspiciousActivity) {
    if (suspiciousActivity.length === 0) {
      return "low";
    }

    const highRiskCount = suspiciousActivity.filter((activity) => activity.riskLevel === "high").length;
    const mediumRiskCount = suspiciousActivity.filter((activity) => activity.riskLevel === "medium").length;
    if (highRiskCount > 0) {
      return "high";
    }
    if (mediumRiskCount > 2) {
      return "medium";
    }
    return "low";
  }
  /**
   * Track new login location
   */
  static async trackLoginLocation(userId, locationData, deviceData, ip) {
    const activity = new UserActivity({
      userId,
      email: locationData.email,
      action: "login",
      ip,
      location: {
        country: locationData.country,
        region: locationData.region,
        city: locationData.city,
        timezone: locationData.timezone,
      },
      device: {
        browser: deviceData.browser,
        version: deviceData.version,
        os: deviceData.os,
        device: deviceData.device,
        userAgent: deviceData.userAgent,
      },
      success: true,
      sessionId: locationData.sessionId,
    });
    await activity.save();
    // Invalidate related caches
    const cacheKeys = [`user_locations:${userId}:*`, `location_analytics:${userId}:*`];
    await Promise.all(cacheKeys.map((pattern) => cacheService.deletePattern(pattern)));
    return activity;
  }
}

export { LocationService };
