// src/modules/admin/services/analytics.service.js
import { User } from "../../users/models/user.model.js";
import mongoose from "mongoose";

export class AnalyticsService {
  /**
   * Get comprehensive analytics overview
   * @param {string} timeRange - Time range for analytics (7d, 30d, 90d)
   */
  async getOverview(timeRange = "30d") {
    const days = this.parseTimeRange(timeRange);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const pipeline = [
      {
        $facet: {
          totalStats: [
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
              },
            },
          ],
          recentStats: [
            {
              $match: { createdAt: { $gte: startDate } },
            },
            {
              $group: {
                _id: null,
                newUsers: { $sum: 1 },
                newActiveUsers: { $sum: { $cond: ["$isActive", 1, 0] } },
              },
            },
          ],
          todayStats: [
            {
              $match: { createdAt: { $gte: todayStart } },
            },
            {
              $group: {
                _id: null,
                newUsersToday: { $sum: 1 },
              },
            },
          ],
          roleDistribution: [
            {
              $group: {
                _id: "$role",
                count: { $sum: 1 },
              },
            },
          ],
          userGrowth: [
            {
              $match: { createdAt: { $gte: startDate } },
            },
            {
              $group: {
                _id: {
                  year: { $year: "$createdAt" },
                  month: { $month: "$createdAt" },
                  day: { $dayOfMonth: "$createdAt" },
                },
                newUsers: { $sum: 1 },
                totalUsers: { $sum: 1 },
              },
            },
            { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
          ],
        },
      },
    ];

    const [result] = await User.aggregate(pipeline);

    const totalStats = result.totalStats[0] || {};
    const recentStats = result.recentStats[0] || {};
    const todayStats = result.todayStats[0] || {};

    // Calculate engagement metrics
    const totalUsers = totalStats.totalUsers || 0;
    const activeUsers = totalStats.activeUsers || 0;
    const newUsers = recentStats.newUsers || 0;
    const newUsersToday = todayStats.newUsersToday || 0;

    return {
      userGrowth: result.userGrowth.map((item) => ({
        date: `${item._id.year}-${String(item._id.month).padStart(2, "0")}-${String(item._id.day).padStart(2, "0")}`,
        newUsers: item.newUsers,
        totalUsers: item.totalUsers,
      })),
      engagementMetrics: {
        dailyActiveUsers: Math.floor(activeUsers * 0.3), // Mock calculation
        weeklyActiveUsers: Math.floor(activeUsers * 0.7),
        monthlyActiveUsers: activeUsers,
        averageSessionDuration: 1800, // 30 minutes
        postsPerUser: 2.5,
        likesPerPost: 15.2,
        commentsPerPost: 3.8,
      },
      contentMetrics: {
        totalPosts: Math.floor(totalUsers * 2.1), // Mock calculation
        totalComments: Math.floor(totalUsers * 5.2),
        totalLikes: Math.floor(totalUsers * 12.3),
        engagementRate: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
      },
      overview: {
        totalUsers,
        activeUsers,
        adminUsers: totalStats.adminUsers || 0,
        superAdminUsers: totalStats.superAdminUsers || 0,
        verifiedUsers: totalStats.verifiedUsers || 0,
        newUsers,
        newUsersToday,
        growthRate: this.calculateGrowthRate(totalUsers, newUsers, days),
        userGrowthTrend: newUsers > 0 ? "up" : "stable",
      },
      roleDistribution: result.roleDistribution,
      timeRange,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get user growth analytics
   * @param {string} period - Period type (daily, weekly, monthly)
   * @param {number} days - Number of days to analyze
   */
  async getUserGrowth(period = "daily", days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let groupBy;
    switch (period) {
      case "weekly":
        groupBy = {
          year: { $year: "$createdAt" },
          week: { $week: "$createdAt" },
        };
        break;
      case "monthly":
        groupBy = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        };
        break;
      default: // daily
        groupBy = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          day: { $dayOfMonth: "$createdAt" },
        };
    }

    const pipeline = [
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: groupBy,
          newUsers: { $sum: 1 },
          activeUsers: { $sum: { $cond: ["$isActive", 1, 0] } },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
    ];

    const growth = await User.aggregate(pipeline);

    return {
      period,
      days,
      growth: growth.map((item) => ({
        ...item._id,
        newUsers: item.newUsers,
        activeUsers: item.activeUsers,
        date: this.formatDate(item._id, period),
      })),
      summary: {
        totalNewUsers: growth.reduce((sum, item) => sum + item.newUsers, 0),
        averageDaily:
          growth.length > 0 ? Math.round(growth.reduce((sum, item) => sum + item.newUsers, 0) / growth.length) : 0,
      },
    };
  }

  /**
   * Get user retention analytics
   * @param {string} cohortPeriod - Cohort period (weekly, monthly)
   */
  async getRetentionAnalytics(cohortPeriod = "monthly") {
    // TODO: Implement based on user activity tracking
    return {
      cohortPeriod,
      cohorts: [],
      averageRetention: {
        week1: 0,
        week2: 0,
        week4: 0,
        week8: 0,
      },
    };
  }

  /**
   * Get user demographics
   */
  async getDemographics() {
    const pipeline = [
      {
        $facet: {
          roleDistribution: [
            {
              $group: {
                _id: "$role",
                count: { $sum: 1 },
                percentage: { $sum: 1 },
              },
            },
          ],
          statusDistribution: [
            {
              $group: {
                _id: "$isActive",
                count: { $sum: 1 },
              },
            },
          ],
          registrationTrends: [
            {
              $match: {
                createdAt: {
                  $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
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
          ],
        },
      },
    ];

    const [result] = await User.aggregate(pipeline);

    // Calculate percentages for role distribution
    const totalUsers = result.roleDistribution.reduce((sum, item) => sum + item.count, 0);
    const roleDistribution = result.roleDistribution.map((item) => ({
      role: item._id,
      count: item.count,
      percentage: totalUsers > 0 ? Math.round((item.count / totalUsers) * 100) : 0,
    }));

    return {
      roleDistribution,
      statusDistribution: result.statusDistribution.map((item) => ({
        status: item._id ? "active" : "inactive",
        count: item.count,
      })),
      registrationTrends: result.registrationTrends,
      totalUsers,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get engagement metrics
   * @param {string} timeRange - Time range for metrics
   */
  async getEngagementMetrics(timeRange = "30d") {
    const days = this.parseTimeRange(timeRange);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get actual user data for engagement calculation
    const [totalUsers, activeUsers, recentLogins] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.countDocuments({
        lastLoginAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    const dailyActiveUsers = Math.floor(recentLogins * 0.4);
    const weeklyActiveUsers = recentLogins;
    const monthlyActiveUsers = activeUsers;

    return {
      timeRange,
      metrics: {
        dailyActiveUsers,
        weeklyActiveUsers,
        monthlyActiveUsers,
        averageSessionDuration: 1800, // 30 minutes
        postsPerUser: 2.5,
        likesPerPost: 15.2,
        commentsPerPost: 3.8,
        engagementRate: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
      },
      trends: {
        dailyActive: dailyActiveUsers > weeklyActiveUsers * 0.3 ? "increasing" : "stable",
        engagement: "stable",
        retention: "improving",
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // Helper methods
  parseTimeRange(timeRange) {
    const match = timeRange.match(/(\d+)([dwmy])/);
    if (!match) {
      return 30;
    } // default

    const [, num, unit] = match;
    const multipliers = { d: 1, w: 7, m: 30, y: 365 };
    return parseInt(num) * (multipliers[unit] || 1);
  }

  calculateGrowthRate(total, recent, days) {
    if (!total || !recent) {
      return 0;
    }
    const dailyRate = recent / days;
    const previousTotal = total - recent;
    return previousTotal > 0 ? Math.round((recent / previousTotal) * 100) : 100;
  }

  formatDate(dateObj, period) {
    const { year, month, day } = dateObj;
    switch (period) {
      case "weekly":
        return `${year}-W${dateObj.week}`;
      case "monthly":
        return `${year}-${month.toString().padStart(2, "0")}`;
      default:
        return `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }
}
