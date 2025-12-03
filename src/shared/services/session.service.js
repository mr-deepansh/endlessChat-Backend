// src/shared/services/session.service.js
import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: { type: String, required: true, unique: true, index: true },
    ipAddress: { type: String, required: true, index: true },
    userAgent: { type: String, required: true },
    os: { type: String, index: true },
    browser: { type: String, index: true },
    device: { type: String, index: true },
    region: { type: String, index: true },
    country: { type: String, index: true },
    city: { type: String },
    isActive: { type: Boolean, default: true, index: true },
    loginAt: { type: Date, default: Date.now, index: true },
    lastActivity: { type: Date, default: Date.now, index: true },
    logoutAt: { type: Date, index: true },
    duration: { type: Number },
    role: { type: String, enum: ["user", "admin", "super_admin"], index: true },
  },
  {
    timestamps: true,
    collection: "sessions",
  },
);

sessionSchema.index({ userId: 1, isActive: 1 });
sessionSchema.index({ role: 1, loginAt: -1 });
sessionSchema.index({ ipAddress: 1, loginAt: -1 });

const Session = mongoose.model("Session", sessionSchema);

export class SessionService {
  async getAdminEngagementAnalytics() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const pipeline = [
      {
        $facet: {
          // Active sessions count
          activeSessions: [
            {
              $match: {
                role: { $in: ["admin", "super_admin"] },
                isActive: true,
              },
            },
            { $count: "total" },
          ],
          // Session duration analytics
          sessionDuration: [
            {
              $match: {
                role: { $in: ["admin", "super_admin"] },
                duration: { $exists: true, $gt: 0 },
              },
            },
            {
              $group: {
                _id: null,
                average: { $avg: "$duration" },
                min: { $min: "$duration" },
                max: { $max: "$duration" },
                total: { $sum: "$duration" },
              },
            },
          ],
          // User activity patterns
          userActivity: [
            {
              $match: {
                role: { $in: ["admin", "super_admin"] },
                loginAt: { $gte: thirtyDaysAgo },
              },
            },
            {
              $addFields: {
                activityLevel: {
                  $cond: [
                    { $gte: ["$lastActivity", oneDayAgo] },
                    "highly_active",
                    {
                      $cond: [{ $gte: ["$lastActivity", sevenDaysAgo] }, "moderately_active", "low_active"],
                    },
                  ],
                },
              },
            },
            {
              $group: {
                _id: "$activityLevel",
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ];

    const [result] = await Session.aggregate(pipeline);

    const activeSessions = result?.activeSessions?.[0]?.total || 0;
    const sessionDuration = result?.sessionDuration?.[0] || {
      average: 0,
      min: 0,
      max: 0,
      total: 0,
    };
    const userActivity = Object.fromEntries(result?.userActivity?.map(item => [item._id, item.count]) || []);

    return {
      activeSessions,
      sessionDuration: {
        average: Math.round(sessionDuration.average || 0),
        min: Math.round(sessionDuration.min || 0),
        max: Math.round(sessionDuration.max || 0),
        total: Math.round(sessionDuration.total || 0),
      },
      userActivity: {
        highly_active: userActivity.highly_active || 0,
        moderately_active: userActivity.moderately_active || 0,
        low_active: userActivity.low_active || 0,
      },
    };
  }

  async getAdminSessionAnalytics(adminId = null) {
    const matchStage = {
      role: { $in: ["admin", "super_admin"] },
    };

    if (adminId) {
      matchStage.userId = new mongoose.Types.ObjectId(adminId);
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$userId",
          totalSessions: { $sum: 1 },
          activeSessions: { $sum: { $cond: ["$isActive", 1, 0] } },
          lastLogin: { $max: "$loginAt" },
          avgDuration: { $avg: "$duration" },
          uniqueIPs: { $addToSet: "$ipAddress" },
          devices: { $addToSet: "$device" },
          browsers: { $addToSet: "$browser" },
          regions: { $addToSet: "$region" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: "$user",
      },
      {
        $project: {
          userId: "$_id",
          username: "$user.username",
          email: "$user.email",
          role: "$user.role",
          totalSessions: 1,
          activeSessions: 1,
          lastLogin: 1,
          avgDuration: { $round: ["$avgDuration", 0] },
          uniqueIPCount: { $size: "$uniqueIPs" },
          deviceCount: { $size: "$devices" },
          browserCount: { $size: "$browsers" },
          regionCount: { $size: "$regions" },
          uniqueIPs: { $slice: ["$uniqueIPs", 5] },
          devices: 1,
          browsers: 1,
          regions: 1,
        },
      },
      { $sort: { lastLogin: -1 } },
    ];

    return await Session.aggregate(pipeline);
  }

  parseUserAgent(userAgent) {
    const ua = userAgent.toLowerCase();

    let os = "Unknown";
    if (ua.includes("windows")) {
      os = "Windows";
    } else if (ua.includes("mac")) {
      os = "macOS";
    } else if (ua.includes("linux")) {
      os = "Linux";
    } else if (ua.includes("android")) {
      os = "Android";
    } else if (ua.includes("ios")) {
      os = "iOS";
    }

    let browser = "Unknown";
    if (ua.includes("chrome")) {
      browser = "Chrome";
    } else if (ua.includes("firefox")) {
      browser = "Firefox";
    } else if (ua.includes("safari")) {
      browser = "Safari";
    } else if (ua.includes("edge")) {
      browser = "Edge";
    }

    let device = "Desktop";
    if (ua.includes("mobile")) {
      device = "Mobile";
    } else if (ua.includes("tablet")) {
      device = "Tablet";
    }

    return { os, browser, device };
  }

  async getLocationFromIP(ipAddress) {
    // TODO: Implement actual IP geolocation service
    return { region: "Unknown", country: "Unknown", city: "Unknown" };
  }
}

export { Session };
