// src/shared/middleware/locationTracker.middleware.js
import { LocationService } from "../../modules/auth/services/location.service.js";
import { Logger } from "../utils/Logger.js";

/**
 * Enterprise Location Tracking Middleware
 * Automatically tracks user login locations with device information
 */
export const locationTracker = async (req, res, next) => {
  try {
    // Only track on successful login
    if (req.method === "POST" && req.route?.path?.includes("login")) {
      const originalSend = res.send;

      res.send = function (data) {
        // Parse response to check if login was successful
        let responseData;
        try {
          responseData = typeof data === "string" ? JSON.parse(data) : data;
        } catch (e) {
          responseData = data;
        }

        // Track location only on successful login
        if (responseData?.success && responseData?.statusCode === 200 && req.user) {
          setImmediate(async () => {
            try {
              await trackUserLocation(req);
            } catch (error) {
              Logger.error("Location tracking failed:", error);
            }
          });
        }

        originalSend.call(this, data);
      };
    }

    next();
  } catch (error) {
    Logger.error("Location tracker middleware error:", error);
    next(); // Continue without blocking the request
  }
};

/**
 * Extract and track user location information
 */
async function trackUserLocation(req) {
  const userId = req.user._id;
  const userAgent = req.get("User-Agent") || "";
  const ip = getClientIP(req);

  // Extract device information from User-Agent
  const deviceInfo = parseUserAgent(userAgent);

  // Get location from IP (in production, use a geolocation service)
  const locationInfo = await getLocationFromIP(ip);

  // Track the login location
  await LocationService.trackLoginLocation(
    userId,
    {
      email: req.user.email,
      country: locationInfo.country,
      region: locationInfo.region,
      city: locationInfo.city,
      timezone: locationInfo.timezone,
      sessionId: req.sessionID || generateSessionId(),
    },
    {
      browser: deviceInfo.browser,
      version: deviceInfo.version,
      os: deviceInfo.os,
      device: deviceInfo.device,
      userAgent,
    },
    ip,
  );
}

/**
 * Extract client IP address from request
 */
function getClientIP(req) {
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    "unknown"
  );
}

/**
 * Parse User-Agent string to extract device information
 */
function parseUserAgent(userAgent) {
  const device = {
    browser: "Unknown",
    version: "Unknown",
    os: "Unknown",
    device: "Unknown",
  };

  if (!userAgent) {
    return device;
  }

  // Browser detection
  if (userAgent.includes("Chrome")) {
    device.browser = "Chrome";
    const match = userAgent.match(/Chrome\/([0-9.]+)/);
    device.version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Firefox")) {
    device.browser = "Firefox";
    const match = userAgent.match(/Firefox\/([0-9.]+)/);
    device.version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
    device.browser = "Safari";
    const match = userAgent.match(/Version\/([0-9.]+)/);
    device.version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Edge")) {
    device.browser = "Edge";
    const match = userAgent.match(/Edge\/([0-9.]+)/);
    device.version = match ? match[1] : "Unknown";
  }

  // OS detection
  if (userAgent.includes("Windows")) {
    device.os = "Windows";
  } else if (userAgent.includes("Mac OS")) {
    device.os = "macOS";
  } else if (userAgent.includes("Linux")) {
    device.os = "Linux";
  } else if (userAgent.includes("Android")) {
    device.os = "Android";
  } else if (userAgent.includes("iOS")) {
    device.os = "iOS";
  }

  // Device type detection
  if (userAgent.includes("Mobile")) {
    device.device = "Mobile";
  } else if (userAgent.includes("Tablet")) {
    device.device = "Tablet";
  } else {
    device.device = "Desktop";
  }

  return device;
}

/**
 * Get location information from IP address
 * In production, integrate with services like MaxMind, IPStack, or similar
 */
async function getLocationFromIP(ip) {
  // Default location for development/localhost
  if (ip === "::1" || ip === "127.0.0.1" || ip === "unknown") {
    return {
      country: "Local",
      region: "Development",
      city: "Localhost",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  try {
    // TODO: Integrate with actual geolocation service
    // Example: const response = await fetch(`https://ipapi.co/${ip}/json/`);
    // const data = await response.json();
    return {
      country: "Unknown",
      region: "Unknown",
      city: "Unknown",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  } catch (error) {
    Logger.error("Geolocation service error:", error);
    return {
      country: "Unknown",
      region: "Unknown",
      city: "Unknown",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
}

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
