// src/modules/auth/routes/security.routes.js
import { Router } from "express";
import { SecurityService } from "../services/security.service.js";
import { verifyJWT } from "../../../shared/middleware/auth.middleware.js";
import { asyncHandler } from "../../../shared/utils/AsyncHandler.js";
import { ApiResponse } from "../../../shared/utils/ApiResponse.js";
import { RedisUtils } from "../../shared/config/redis.config.js";

const router = Router();

// Apply JWT verification to all routes
router.use(verifyJWT);

/**
 * Get comprehensive security dashboard
 */
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const cacheKey = `security:dashboard:${userId}`;

    // Try to get cached data first
    let dashboardData = await RedisUtils.get(cacheKey);

    if (!dashboardData) {
      // Generate fresh security dashboard data
      const [threatAssessment, suspiciousPatterns] = await Promise.all([
        SecurityService.performThreatAssessment(userId, 7),
        SecurityService.detectSuspiciousPatterns(userId, 30),
      ]);

      dashboardData = {
        threatAssessment,
        suspiciousPatterns,
        securityScore: {
          overall: calculateSecurityScore(threatAssessment),
          factors: {
            authentication: threatAssessment.threatLevel === "low" ? 95 : 70,
            deviceSecurity: suspiciousPatterns.length < 3 ? 90 : 60,
            locationSecurity: threatAssessment.metrics?.countryCount < 3 ? 85 : 65,
            behaviorAnalysis: threatAssessment.metrics?.failureRate < 5 ? 92 : 55,
          },
        },
        recommendations: SecurityService.generateSecurityRecommendations({
          threatIntelligence: threatAssessment.metrics,
          suspiciousActivity: suspiciousPatterns,
          summary: { overallRiskLevel: threatAssessment.threatLevel },
        }),
        lastUpdated: new Date().toISOString(),
      };

      // Cache for 5 minutes
      await RedisUtils.setWithTTL(cacheKey, dashboardData, 300);
    }

    res.status(200).json(new ApiResponse(200, dashboardData, "Security dashboard retrieved successfully"));
  }),
);

/**
 * Get real-time threat assessment
 */
router.get(
  "/threat-assessment",
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { timeframe = 7 } = req.query;

    const assessment = await SecurityService.performThreatAssessment(userId, parseInt(timeframe));

    res.status(200).json(new ApiResponse(200, assessment, "Threat assessment completed successfully"));
  }),
);

/**
 * Get compliance report
 */
router.get(
  "/compliance-report",
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { days = 30 } = req.query;

    // TODO: Fetch real analytics data
    const analytics = {
      summary: {
        totalLogins: 0,
        suspiciousEvents: 0,
        overallRiskLevel: "unknown",
        period: `${days} days`,
      },
    };

    const report = SecurityService.generateComplianceReport(analytics);

    res.status(200).json(new ApiResponse(200, report, "Compliance report generated successfully"));
  }),
);

/**
 * Validate IP threat status
 */
router.post(
  "/validate-ip",
  asyncHandler(async (req, res) => {
    const { ip } = req.body;

    if (!ip) {
      return res.status(400).json(new ApiResponse(400, null, "IP address is required"));
    }

    const validation = await SecurityService.validateIPThreat(ip);

    res.status(200).json(new ApiResponse(200, validation, "IP validation completed successfully"));
  }),
);

/**
 * Helper function to calculate overall security score
 */
function calculateSecurityScore(threatAssessment) {
  const baseScore = 100;
  let deductions = 0;

  switch (threatAssessment.threatLevel) {
    case "critical":
      deductions += 40;
      break;
    case "high":
      deductions += 25;
      break;
    case "medium":
      deductions += 10;
      break;
    default:
      deductions += 0;
  }

  // Additional deductions based on metrics
  if (threatAssessment.metrics?.failureRate > 15) {
    deductions += 15;
  }
  if (threatAssessment.metrics?.uniqueIPCount > 10) {
    deductions += 10;
  }
  if (threatAssessment.metrics?.deviceCount > 5) {
    deductions += 5;
  }

  return Math.max(baseScore - deductions, 0);
}

export default router;
