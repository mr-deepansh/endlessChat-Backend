// src/modules/admin/services/system.service.js
import { User } from "../../users/models/user.model.js";
import mongoose from "mongoose";
import os from "os";

export class SystemService {
  /**
   * Get server health metrics
   */
  async getServerHealth() {
    const startTime = Date.now();

    try {
      // Test database connection
      const dbStatus = await this.testDatabaseConnection();

      // Get system metrics
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const uptime = process.uptime();

      // System load
      const loadAverage = os.loadavg();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();

      const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime),
        version: "2.0.0",
        environment: process.env.NODE_ENV || "development",

        services: {
          database: dbStatus.status,
          redis: "connected", // Mock - implement actual Redis check
          email: "operational",
        },

        performance: {
          responseTime: Date.now() - startTime,
          memory: {
            used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            percentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
            system: {
              total: Math.round(totalMemory / 1024 / 1024),
              free: Math.round(freeMemory / 1024 / 1024),
              used: Math.round((totalMemory - freeMemory) / 1024 / 1024),
            },
          },
          cpu: {
            usage: Math.round((cpuUsage.user + cpuUsage.system) / 1000000), // Convert to ms
            loadAverage: loadAverage.map((load) => Math.round(load * 100) / 100),
            cores: os.cpus().length,
          },
        },

        database: {
          status: dbStatus.status,
          responseTime: dbStatus.responseTime,
          connections: dbStatus.connections,
        },

        alerts: this.generateHealthAlerts(memoryUsage, loadAverage),
      };

      // Determine overall health status
      if (health.performance.memory.percentage > 90 || loadAverage[0] > 2) {
        health.status = "warning";
      }
      if (health.performance.memory.percentage > 95 || loadAverage[0] > 4) {
        health.status = "critical";
      }

      return health;
    } catch (error) {
      return {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error.message,
        uptime: Math.floor(process.uptime()),
      };
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    try {
      const db = mongoose.connection.db;

      // Get collection stats
      const collections = await db.listCollections().toArray();
      const collectionStats = [];

      for (const collection of collections) {
        try {
          const stats = await db.collection(collection.name).stats();
          collectionStats.push({
            name: collection.name,
            documents: stats.count || 0,
            size: Math.round((stats.size || 0) / 1024), // KB
            avgObjSize: Math.round(stats.avgObjSize || 0),
            indexes: stats.nindexes || 0,
          });
        } catch (err) {
          // Skip collections that don't support stats
          collectionStats.push({
            name: collection.name,
            documents: 0,
            size: 0,
            avgObjSize: 0,
            indexes: 0,
          });
        }
      }

      // Get database stats
      const dbStats = await db.stats();

      return {
        database: {
          name: db.databaseName,
          collections: collections.length,
          totalSize: Math.round((dbStats.dataSize || 0) / 1024 / 1024), // MB
          indexSize: Math.round((dbStats.indexSize || 0) / 1024 / 1024), // MB
          documents: dbStats.objects || 0,
        },
        collections: collectionStats.sort((a, b) => b.documents - a.documents),
        performance: {
          avgObjSize: Math.round(dbStats.avgObjSize || 0),
          dataSize: Math.round((dbStats.dataSize || 0) / 1024 / 1024),
          storageSize: Math.round((dbStats.storageSize || 0) / 1024 / 1024),
          indexes: dbStats.indexes || 0,
        },
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        error: error.message,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Test database connection
   */
  async testDatabaseConnection() {
    const startTime = Date.now();

    try {
      // Simple query to test connection
      await User.findOne({}).limit(1);

      return {
        status: "connected",
        responseTime: Date.now() - startTime,
        connections: mongoose.connection.readyState === 1 ? "active" : "inactive",
      };
    } catch (error) {
      return {
        status: "disconnected",
        responseTime: Date.now() - startTime,
        error: error.message,
        connections: "failed",
      };
    }
  }

  /**
   * Generate health alerts based on system metrics
   */
  generateHealthAlerts(memoryUsage, loadAverage) {
    const alerts = [];

    const memoryPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    if (memoryPercentage > 85) {
      alerts.push({
        type: "warning",
        message: `High memory usage: ${Math.round(memoryPercentage)}%`,
        severity: memoryPercentage > 95 ? "critical" : "warning",
      });
    }

    if (loadAverage[0] > 2) {
      alerts.push({
        type: "warning",
        message: `High CPU load: ${loadAverage[0].toFixed(2)}`,
        severity: loadAverage[0] > 4 ? "critical" : "warning",
      });
    }

    return alerts;
  }

  /**
   * Get system configuration
   */
  async getSystemConfig() {
    return {
      system: {
        version: "2.0.0",
        environment: process.env.NODE_ENV || "development",
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: Math.floor(process.uptime()),
      },
      database: {
        status: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        host: process.env.MONGODB_URI ? "configured" : "not_configured",
        readPreference: "primary",
        writeConcern: "majority",
      },
      security: {
        jwtExpiry: process.env.ACCESS_TOKEN_EXPIRY || "1h",
        refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || "7d",
        passwordPolicy: "strong",
        mfaEnabled: false,
        httpsEnabled: process.env.HTTPS_ENABLED === "true",
      },
      features: {
        userManagement: true,
        adminPanel: true,
        analytics: true,
        auditLogs: true,
        fileUploads: true,
        emailService: !!process.env.EMAIL_USERNAME,
        caching: !!process.env.REDIS_HOST,
      },
      limits: {
        maxFileSize: process.env.MAX_FILE_SIZE || "5MB",
        rateLimitMax: process.env.RATE_LIMIT_MAX || "1000",
        rateLimitWindow: process.env.RATE_LIMIT_WINDOW_MS || "15min",
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Emergency system lockdown
   */
  async emergencyLockdown(data) {
    // TODO: Implement actual lockdown mechanism
    // 1. Set a global flag in Redis/database
    // 2. Update middleware to block requests
    // 3. Send notifications to all admins
    throw new Error("Emergency lockdown not implemented");
  }
}
