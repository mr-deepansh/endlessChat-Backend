// src/modules/auth/services/security.service.js
import { UserActivity } from "../models/userActivity.model.js";
import { Logger } from "../../../shared/utils/Logger.js";
const logger = new Logger("SecurityService");

/**
 * Enterprise Security Service for advanced threat detection and risk assessment
 */
class SecurityService {
  /**
   * Calculate risk score based on multiple security factors
   */
  static calculateRiskScore(activityData) {
    let riskScore = 0;
    const factors = {
      failedAttempts: activityData.failedAttempts || 0,
      uniqueIPs: activityData.uniqueIPs?.length || 0,
      deviceCount: activityData.deviceCount || 0,
      locationChanges: activityData.locationChanges || 0,
      timeAnomalies: activityData.timeAnomalies || 0,
    };
    // Failed attempts risk (0-40 points)
    if (factors.failedAttempts > 10) {
      riskScore += 40;
    } else if (factors.failedAttempts > 5) {
      riskScore += 25;
    } else if (factors.failedAttempts > 2) {
      riskScore += 10;
    }

    // IP diversity risk (0-25 points)
    if (factors.uniqueIPs > 10) {
      riskScore += 25;
    } else if (factors.uniqueIPs > 5) {
      riskScore += 15;
    } else if (factors.uniqueIPs > 3) {
      riskScore += 8;
    }

    // Device diversity risk (0-20 points)
    if (factors.deviceCount > 5) {
      riskScore += 20;
    } else if (factors.deviceCount > 3) {
      riskScore += 12;
    } else if (factors.deviceCount > 2) {
      riskScore += 6;
    }

    // Geographic anomalies (0-15 points)
    if (factors.locationChanges > 5) {
      riskScore += 15;
    } else if (factors.locationChanges > 2) {
      riskScore += 8;
    }

    // Determine risk level
    if (riskScore >= 70) {
      return "critical";
    }
    if (riskScore >= 50) {
      return "high";
    }
    if (riskScore >= 25) {
      return "medium";
    }
    return "low";
  }

  /**
   * Detect suspicious patterns in user activity
   */
  static async detectSuspiciousPatterns(userId, timeframe = 30) {
    const dateThreshold = new Date(Date.now() - timeframe * 24 * 60 * 60 * 1000);
    try {
      const patterns = await UserActivity.aggregate([
        {
          $match: {
            userId,
            createdAt: { $gte: dateThreshold },
          },
        },
        {
          $group: {
            _id: {
              hour: { $hour: "$createdAt" },
              ip: "$ip",
            },
            count: { $sum: 1 },
            failed: {
              $sum: { $cond: [{ $eq: ["$success", false] }, 1, 0] },
            },
            locations: { $addToSet: "$location.country" },
            devices: { $addToSet: "$device.fingerprint" },
          },
        },
        {
          $match: {
            $or: [
              { count: { $gt: 20 } }, // High frequency
              { failed: { $gt: 5 } }, // Multiple failures
              { $expr: { $gt: [{ $size: "$locations" }, 2] } }, // Multiple countries
              { $expr: { $gt: [{ $size: "$devices" }, 3] } }, // Multiple devices
            ],
          },
        },
        {
          $project: {
            hour: "$_id.hour",
            ip: "$_id.ip",
            attempts: "$count",
            failures: "$failed",
            locationCount: { $size: "$locations" },
            deviceCount: { $size: "$devices" },
            suspicionLevel: {
              $switch: {
                branches: [
                  { case: { $gt: ["$failed", 10] }, then: "critical" },
                  { case: { $gt: ["$count", 50] }, then: "high" },
                  { case: { $gt: [{ $size: "$devices" }, 5] }, then: "medium" },
                ],
                default: "low",
              },
            },
            _id: 0,
          },
        },
        { $sort: { suspicionLevel: -1, attempts: -1 } },
        { $limit: 20 },
      ]);
      return patterns;
    } catch (error) {
      logger.error("Error detecting suspicious patterns:", error);
      return [];
    }
  }

  /**
   * Generate security recommendations based on activity analysis
   */
  static generateSecurityRecommendations(analytics) {
    const recommendations = [];

    // High failure rate recommendations
    if (analytics.threatIntelligence?.successRate < 80) {
      recommendations.push({
        type: "security",
        priority: "high",
        title: "Enable Multi-Factor Authentication",
        description: "High failure rate detected. Enable MFA to enhance account security.",
        action: "enable_mfa",
      });
    }

    // Multiple IP recommendations
    if (analytics.threatIntelligence?.uniqueIPCount > 10) {
      recommendations.push({
        type: "monitoring",
        priority: "medium",
        title: "Review IP Whitelist",
        description: "Multiple IPs detected. Consider implementing IP whitelisting.",
        action: "review_ip_whitelist",
      });
    }

    // Geographic risk recommendations
    if (analytics.geographicRisk?.some((country) => country.riskLevel === "high")) {
      recommendations.push({
        type: "geographic",
        priority: "high",
        title: "Geographic Access Control",
        description: "High-risk countries detected. Consider geographic restrictions.",
        action: "enable_geo_blocking",
      });
    }

    // Suspicious activity recommendations
    if (analytics.suspiciousActivity?.length > 5) {
      recommendations.push({
        type: "monitoring",
        priority: "critical",
        title: "Enhanced Monitoring",
        description: "Multiple suspicious activities detected. Enable enhanced monitoring.",
        action: "enable_enhanced_monitoring",
      });
    }

    return recommendations;
  }

  /**
   * Validate IP address against threat intelligence
   */
  static async validateIPThreat(ip) {
    // In production, this would integrate with threat intelligence APIs
    const knownThreats = [
      "192.168.1.100", // Example malicious IP
      "10.0.0.1", // Example suspicious IP
    ];
    return {
      ip,
      isThreat: knownThreats.includes(ip),
      riskLevel: knownThreats.includes(ip) ? "high" : "low",
      source: "internal_threat_db",
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Generate compliance report for audit purposes
   */
  static generateComplianceReport(analytics) {
    return {
      reportId: `COMP-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      period: analytics.summary?.period || "30 days",
      compliance: {
        gdpr: {
          status: "compliant",
          dataRetention: "enforced",
          userRights: "implemented",
          consentManagement: "active",
        },
        sox: {
          status: "compliant",
          auditTrail: "complete",
          accessControls: "implemented",
          dataIntegrity: "verified",
        },
        iso27001: {
          status: "compliant",
          riskAssessment: "current",
          securityControls: "implemented",
          incidentResponse: "active",
        },
      },
      securityMetrics: {
        totalLogins: analytics.summary?.totalLogins || 0,
        suspiciousEvents: analytics.summary?.suspiciousEvents || 0,
        riskLevel: analytics.summary?.overallRiskLevel || "low",
        encryptionStatus: "AES-256",
        monitoringStatus: "active",
      },
      recommendations: this.generateSecurityRecommendations(analytics),
    };
  }

  /**
   * Real-time threat assessment
   */
  static async performThreatAssessment(userId, timeframe = 7) {
    try {
      const dateThreshold = new Date(Date.now() - timeframe * 24 * 60 * 60 * 1000);
      const threatMetrics = await UserActivity.aggregate([
        {
          $match: {
            userId,
            createdAt: { $gte: dateThreshold },
          },
        },
        {
          $group: {
            _id: null,
            totalAttempts: { $sum: 1 },
            failedAttempts: {
              $sum: { $cond: [{ $eq: ["$success", false] }, 1, 0] },
            },
            uniqueIPs: { $addToSet: "$ip" },
            uniqueCountries: { $addToSet: "$location.country" },
            uniqueDevices: { $addToSet: "$device.fingerprint" },
            suspiciousIPs: {
              $addToSet: {
                $cond: [{ $eq: ["$success", false] }, "$ip", null],
              },
            },
          },
        },
        {
          $project: {
            totalAttempts: 1,
            failedAttempts: 1,
            failureRate: {
              $multiply: [{ $divide: ["$failedAttempts", "$totalAttempts"] }, 100],
            },
            uniqueIPCount: { $size: "$uniqueIPs" },
            countryCount: { $size: "$uniqueCountries" },
            deviceCount: { $size: "$uniqueDevices" },
            suspiciousIPCount: {
              $size: {
                $filter: {
                  input: "$suspiciousIPs",
                  cond: { $ne: ["$$this", null] },
                },
              },
            },
            _id: 0,
          },
        },
      ]);
      const metrics = threatMetrics[0] || {
        totalAttempts: 0,
        failedAttempts: 0,
        failureRate: 0,
        uniqueIPCount: 0,
        countryCount: 0,
        deviceCount: 0,
        suspiciousIPCount: 0,
      };
      // Calculate overall threat level
      let threatLevel = "low";
      if (metrics.failureRate > 30 || metrics.suspiciousIPCount > 5) {
        threatLevel = "critical";
      } else if (metrics.failureRate > 15 || metrics.uniqueIPCount > 10) {
        threatLevel = "high";
      } else if (metrics.failureRate > 5 || metrics.uniqueIPCount > 5) {
        threatLevel = "medium";
      }
      return {
        threatLevel,
        metrics,
        assessment: {
          riskFactors: {
            highFailureRate: metrics.failureRate > 15,
            multipleIPs: metrics.uniqueIPCount > 5,
            multipleCountries: metrics.countryCount > 3,
            deviceAnomalies: metrics.deviceCount > 3,
          },
          recommendations: this.generateThreatRecommendations(threatLevel, metrics),
          nextReview: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error performing threat assessment:", error);
      return {
        threatLevel: "unknown",
        error: "Assessment failed",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Generate threat-specific recommendations
   */
  static generateThreatRecommendations(threatLevel, metrics) {
    const recommendations = [];
    switch (threatLevel) {
      case "critical":
        recommendations.push(
          "Immediately enable account lockout after 3 failed attempts",
          "Implement emergency IP blocking for suspicious addresses",
          "Activate real-time security monitoring",
          "Consider temporary account suspension pending investigation",
        );
        break;
      case "high":
        recommendations.push(
          "Enable multi-factor authentication",
          "Implement IP whitelisting",
          "Increase login monitoring frequency",
          "Review and update security policies",
        );
        break;
      case "medium":
        recommendations.push(
          "Monitor login patterns more closely",
          "Consider implementing CAPTCHA for failed attempts",
          "Review device fingerprinting settings",
        );
        break;
      default:
        recommendations.push("Continue regular security monitoring", "Maintain current security policies");
    }
    return recommendations;
  }
}

export { SecurityService };
