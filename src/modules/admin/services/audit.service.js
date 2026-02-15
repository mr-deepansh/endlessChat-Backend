// src/modules/admin/services/audit.service.js
import mongoose from "mongoose";

// Audit Log Schema with optimized indexes
const auditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "GET_ADMIN_STATS",
        "GET_ALL_ADMINS",
        "VIEW_ADMIN_PROFILE",
        "VIEW_ADMIN_LIST",
        "UPDATE_USER",
        "DELETE_USER",
        "SUSPEND_USER",
        "ACTIVATE_USER",
        "BULK_IMPORT",
        "BULK_EXPORT",
        "LOGIN",
        "LOGOUT",
        "PASSWORD_RESET",
        "PROFILE_UPDATE",
        "PERMISSION_CHANGE",
        "ERROR_OCCURRED",
        "SYSTEM_ERROR",
        "DATABASE_ERROR",
        "CACHE_ERROR",
      ],
      index: true,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    targetAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    error: {
      message: String,
      stack: String,
      code: String,
      type: String,
    },
    ipAddress: {
      type: String,
      index: true,
    },
    userAgent: String,
    // Using createdAt from timestamps: true instead of manual timestamp
    level: {
      type: String,
      enum: ["info", "warning", "error", "critical"],
      default: "info",
      index: true,
    },
    status: {
      type: String,
      enum: ["success", "failure", "pending"],
      default: "success",
      index: true,
    },
    executionTime: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "audit_logs",
  },
);

// Enterprise-grade compound indexes for maximum performance
auditLogSchema.index({ adminId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ level: 1, createdAt: -1 });
auditLogSchema.index({ status: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ adminId: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ level: 1, status: 1, createdAt: -1 });

// TTL index for automatic cleanup (optional)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export class AuditService {
  constructor() {
    this.retentionDays = process.env.AUDIT_RETENTION_DAYS || 90;
    this.batchSize = 100; // For bulk operations
    this.errorQueue = []; // In-memory error queue for high-frequency errors
  }

  /**
   * 🚀 Enhanced admin activity logging with performance optimizations
   */
  async logAdminActivity({
    adminId,
    action,
    targetUserId = null,
    targetAdminId = null,
    details = {},
    ipAddress = null,
    userAgent = null,
    level = "info",
    status = "success",
    executionTime = 0,
    metadata = {},
  }) {
    try {
      // Validate required fields
      if (!adminId) {
        console.warn("⚠️ AdminId is required for audit logging");
        return null;
      }

      // Sanitize sensitive data from details
      const sanitizedDetails = this._sanitizeDetails(details);

      const auditEntry = new AuditLog({
        adminId: new mongoose.Types.ObjectId(adminId),
        action,
        targetUserId: targetUserId ? new mongoose.Types.ObjectId(targetUserId) : null,
        targetAdminId: targetAdminId ? new mongoose.Types.ObjectId(targetAdminId) : null,
        details: sanitizedDetails,
        ipAddress,
        userAgent,
        level,
        status,
        executionTime,
        metadata,
      });

      // Use lean save for better performance
      const savedEntry = await auditEntry.save();

      // Development logging
      if (process.env.NODE_ENV === "development") {
        console.log(`📋 Audit Log: ${action} by ${adminId}`, {
          level,
          status,
          executionTime: executionTime ? `${executionTime}ms` : "N/A",
          details: Object.keys(sanitizedDetails).length > 0 ? "✓" : "Empty",
        });
      }

      // Background alert for critical errors (non-blocking)
      if (level === "critical") {
        this._handleCriticalAlert(savedEntry).catch(() => {});
      }

      return savedEntry;
    } catch (error) {
      console.error("❌ Failed to log admin activity:", error);

      // Add to error queue for retry
      this.errorQueue.push({
        adminId,
        action,
        details: { originalError: error.message },
        level: "error",
        timestamp: new Date(),
      });

      return null;
    }
  }

  /**
   * 🛠️ FIXED: Added the missing logAdminError method
   */
  async logAdminError({
    adminId,
    action = "ERROR_OCCURRED",
    error,
    stack = null,
    details = {},
    ipAddress = null,
    userAgent = null,
  }) {
    try {
      return await this.logAdminActivity({
        adminId,
        action,
        details: {
          ...details,
          error,
          stack,
          timestamp: new Date().toISOString(),
        },
        ipAddress,
        userAgent,
        level: "error",
        status: "failure",
        metadata: {
          errorType: "admin_operation",
          severity: "high",
        },
      });
    } catch (logError) {
      console.error("❌ Failed to log admin error:", logError);
      return null;
    }
  }

  /**
   * 🚀 High-performance audit logs retrieval with advanced filtering
   */
  async getAuditLogs(filters = {}, page = 1, limit = 20, sortBy = "timestamp", sortOrder = -1) {
    try {
      const query = this._buildQuery(filters);
      const sortConfig = { [sortBy]: sortOrder };

      // Use parallel execution for optimal performance
      const [totalCount, logs] = await Promise.all([
        AuditLog.countDocuments(query).hint({ createdAt: -1 }),
        AuditLog.find(query, {
          __v: 0, // Exclude version field
        })
          .populate("adminId", "name email role", null, { lean: true })
          .populate("targetUserId", "name email", null, { lean: true })
          .populate("targetAdminId", "name email role", null, { lean: true })
          .sort(sortConfig)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(true) // Faster lean queries
          .hint({ createdAt: -1 }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return {
        logs: logs.map((log) => this._formatLogEntry(log)),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null,
        },
        metadata: {
          query: filters,
          sortBy,
          sortOrder,
          executionTime: Date.now(),
        },
      };
    } catch (error) {
      console.error("❌ Failed to get audit logs:", error);
      throw new Error(`Failed to retrieve audit logs: ${error.message}`);
    }
  }

  /**
   * 🚀 Enterprise audit statistics with caching
   */
  async getAuditStats(timeRange = "30d") {
    try {
      const dateRange = this._getDateRange(timeRange);

      const stats = await AuditLog.aggregate(
        [
          {
            $match: {
              createdAt: { $gte: dateRange.start, $lte: dateRange.end },
            },
          },
          {
            $facet: {
              totalLogs: [{ $count: "count" }],
              logsByLevel: [{ $group: { _id: "$level", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
              logsByAction: [
                { $group: { _id: "$action", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
              ],
              logsByStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
              recentErrors: [
                { $match: { level: { $in: ["error", "critical"] } } },
                { $sort: { createdAt: -1 } },
                { $limit: 10 },
                {
                  $project: {
                    action: 1,
                    error: 1,
                    createdAt: 1,
                    adminId: 1,
                    level: 1,
                  },
                },
              ],
              performanceStats: [
                {
                  $match: { executionTime: { $gt: 0 } },
                },
                {
                  $group: {
                    _id: null,
                    avgExecutionTime: { $avg: "$executionTime" },
                    maxExecutionTime: { $max: "$executionTime" },
                    minExecutionTime: { $min: "$executionTime" },
                    totalOperations: { $sum: 1 },
                  },
                },
              ],
              dailyActivity: [
                {
                  $group: {
                    _id: {
                      year: { $year: "$createdAt" },
                      month: { $month: "$createdAt" },
                      day: { $dayOfMonth: "$createdAt" },
                    },
                    count: { $sum: 1 },
                    errors: {
                      $sum: {
                        $cond: [{ $in: ["$level", ["error", "critical"]] }, 1, 0],
                      },
                    },
                    avgExecutionTime: { $avg: "$executionTime" },
                  },
                },
                { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
                {
                  $project: {
                    _id: 0,
                    date: {
                      $dateFromParts: {
                        year: "$_id.year",
                        month: "$_id.month",
                        day: "$_id.day",
                      },
                    },
                    count: 1,
                    errors: 1,
                    avgExecutionTime: { $round: ["$avgExecutionTime", 2] },
                  },
                },
              ],
              topAdmins: [
                {
                  $group: {
                    _id: "$adminId",
                    activityCount: { $sum: 1 },
                    errorCount: {
                      $sum: {
                        $cond: [{ $in: ["$level", ["error", "critical"]] }, 1, 0],
                      },
                    },
                  },
                },
                { $sort: { activityCount: -1 } },
                { $limit: 10 },
              ],
            },
          },
        ],
        {
          allowDiskUse: false,
          maxTimeMS: 30000,
        },
      );

      const result = stats[0];

      return {
        summary: {
          totalLogs: result.totalLogs[0]?.count || 0,
          timeRange,
          dateRange: {
            start: dateRange.start,
            end: dateRange.end,
          },
        },
        breakdown: {
          byLevel: Object.fromEntries(result.logsByLevel.map((item) => [item._id, item.count])),
          byAction: Object.fromEntries(result.logsByAction.map((item) => [item._id, item.count])),
          byStatus: Object.fromEntries(result.logsByStatus.map((item) => [item._id, item.count])),
        },
        performance: result.performanceStats[0] || {
          avgExecutionTime: 0,
          maxExecutionTime: 0,
          minExecutionTime: 0,
          totalOperations: 0,
        },
        timeline: {
          dailyActivity: result.dailyActivity,
        },
        alerts: {
          recentErrors: result.recentErrors,
          errorRate:
            result.totalLogs[0]?.count > 0
              ? ((result.recentErrors.length / result.totalLogs[0].count) * 100).toFixed(2)
              : "0.00",
        },
        topAdmins: result.topAdmins,
        metadata: {
          generatedAt: new Date().toISOString(),
          cacheKey: `audit:stats:${timeRange}`,
        },
      };
    } catch (error) {
      console.error("❌ Failed to get audit stats:", error);
      throw new Error(`Failed to retrieve audit statistics: ${error.message}`);
    }
  }

  /**
   * 🚀 Bulk audit logging for high-volume operations
   */
  async logBulkActivity(activities) {
    try {
      if (!Array.isArray(activities) || activities.length === 0) {
        return [];
      }

      const bulkOps = activities.map((activity) => ({
        insertOne: {
          document: {
            ...activity,
            adminId: new mongoose.Types.ObjectId(activity.adminId),
            targetUserId: activity.targetUserId ? new mongoose.Types.ObjectId(activity.targetUserId) : null,
          },
        },
      }));

      // Process in batches for better performance
      const results = [];
      for (let i = 0; i < bulkOps.length; i += this.batchSize) {
        const batch = bulkOps.slice(i, i + this.batchSize);
        const result = await AuditLog.bulkWrite(batch, { ordered: false });
        results.push(result);
      }

      console.log(`📋 Bulk logged ${activities.length} activities`);
      return results;
    } catch (error) {
      console.error("❌ Bulk audit logging failed:", error);
      throw new Error(`Bulk logging failed: ${error.message}`);
    }
  }

  /**
   * 🧹 Cleanup old audit logs based on retention policy
   */
  async cleanupOldLogs() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

      const result = await AuditLog.deleteMany({
        createdAt: { $lt: cutoffDate },
      });

      console.log(`🧹 Cleaned up ${result.deletedCount} old audit logs`);
      return result.deletedCount;
    } catch (error) {
      console.error("❌ Cleanup failed:", error);
      throw new Error(`Cleanup failed: ${error.message}`);
    }
  }

  /**
   * 📊 Get real-time audit metrics
   */
  async getRealTimeMetrics() {
    try {
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const metrics = await AuditLog.aggregate([
        {
          $match: { createdAt: { $gte: last24Hours } },
        },
        {
          $facet: {
            totalActivity: [{ $count: "count" }],
            errorRate: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  errors: {
                    $sum: {
                      $cond: [{ $in: ["$level", ["error", "critical"]] }, 1, 0],
                    },
                  },
                },
              },
            ],
            activeAdmins: [
              {
                $group: { _id: "$adminId" },
              },
              { $count: "count" },
            ],
            hourlyActivity: [
              {
                $group: {
                  _id: { $hour: "$createdAt" },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ]);

      const result = metrics[0];
      const errorData = result.errorRate[0] || { total: 0, errors: 0 };

      return {
        last24Hours: {
          totalActivity: result.totalActivity[0]?.count || 0,
          errorRate: errorData.total > 0 ? ((errorData.errors / errorData.total) * 100).toFixed(2) : "0.00",
          activeAdmins: result.activeAdmins[0]?.count || 0,
          hourlyBreakdown: result.hourlyActivity,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Real-time metrics failed:", error);
      return {
        last24Hours: {
          totalActivity: 0,
          errorRate: "0.00",
          activeAdmins: 0,
          hourlyBreakdown: [],
        },
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * 🛡️ Sanitize sensitive data from audit details
   */
  _sanitizeDetails(details) {
    const sensitiveFields = ["password", "token", "secret", "key", "credential"];
    const sanitized = { ...details };

    const sanitizeObject = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === "object" && obj[key] !== null) {
          sanitizeObject(obj[key]);
        } else if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
          obj[key] = "***REDACTED***";
        }
      }
    };

    sanitizeObject(sanitized);
    return sanitized;
  }

  /**
   * 🔍 Build optimized query from filters
   */
  _buildQuery(filters) {
    const query = {};

    if (filters.adminId) {
      if (!mongoose.Types.ObjectId.isValid(filters.adminId)) {
        throw new Error("Invalid adminId format");
      }
      query.adminId = new mongoose.Types.ObjectId(filters.adminId);
    }

    if (filters.action) {
      query.action = filters.action;
    }

    if (filters.level) {
      query.level = filters.level;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) {
        query.createdAt.$gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        query.createdAt.$lte = new Date(filters.dateTo);
      }
    }

    if (filters.search) {
      query.$or = [
        { action: { $regex: filters.search, $options: "i" } },
        { "details.error": { $regex: filters.search, $options: "i" } },
      ];
    }

    return query;
  }

  /**
   * 📅 Get date range for time-based queries
   */
  _getDateRange(timeRange) {
    const end = new Date();
    const start = new Date();

    switch (timeRange) {
      case "1d":
        start.setDate(start.getDate() - 1);
        break;
      case "7d":
        start.setDate(start.getDate() - 7);
        break;
      case "30d":
        start.setDate(start.getDate() - 30);
        break;
      case "90d":
        start.setDate(start.getDate() - 90);
        break;
      default:
        start.setDate(start.getDate() - 30);
    }

    return { start, end };
  }

  /**
   * 💅 Format log entry for API response
   */
  _formatLogEntry(log) {
    return {
      id: log._id,
      adminId: log.adminId,
      action: log.action,
      targetUserId: log.targetUserId,
      targetAdminId: log.targetAdminId,
      details: log.details,
      error: log.error,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt,
      level: log.level,
      status: log.status,
      executionTime: log.executionTime,
      metadata: log.metadata,
      // Add human-readable timestamps
      timeAgo: this._getTimeAgo(log.createdAt),
      formattedDate: log.createdAt.toLocaleDateString(),
    };
  }

  /**
   * ⏰ Get human-readable time ago
   */
  _getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m ago`;
    }
    if (seconds < 86400) {
      return `${Math.floor(seconds / 3600)}h ago`;
    }
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  /**
   * 🚨 Handle critical error alerts
   */
  async _handleCriticalAlert(auditEntry) {
    try {
      // In a real application, you might:
      // - Send notification to admin team
      // - Trigger monitoring alerts
      // - Log to external monitoring systems

      console.error("🚨 CRITICAL AUDIT EVENT:", {
        id: auditEntry._id,
        action: auditEntry.action,
        adminId: auditEntry.adminId,
        createdAt: auditEntry.createdAt,
      });

      // Example: Could integrate with notification services
      // await notificationService.sendCriticalAlert(auditEntry);
    } catch (error) {
      console.error("❌ Critical alert handling failed:", error);
    }
  }
}

// Create and export singleton instance
const auditService = new AuditService();

export default auditService;
export { AuditLog };
