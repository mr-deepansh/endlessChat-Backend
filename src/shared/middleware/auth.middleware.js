// src/shared/middleware/auth.middleware.js
import jwt from "jsonwebtoken";
import { User } from "../../modules/users/models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/AsyncHandler.js";
import { CacheService } from "../../shared/utils/Cache.js";
import { logger } from "../services/logger.service.js";

// Enterprise fallback constants
const FALLBACK_CACHE_TTL = 300; // 5 minutes
const MAX_RETRY_ATTEMPTS = 3;

// Optimized cache operations for millions of users
const isTokenBlacklisted = async (token) => await CacheService.isTokenBlacklisted(token);

const getCachedUser = async (userId) => await CacheService.getCachedUser(userId);

const setCachedUser = async (userId, userData, ttl = 300) => await CacheService.cacheUser(userId, userData, ttl);

// 🔥 OPTIMIZED AUTH MIDDLEWARE WITH AUTO TOKEN REFRESH
export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    let token = req.cookies?.accessToken || req.body?.accessToken;

    logger.info("🔍 Auth Middleware Debug", {
      hasCookies: !!req.cookies,
      cookieKeys: req.cookies ? Object.keys(req.cookies) : [],
      hasAccessToken: !!req.cookies?.accessToken,
      hasAuthHeader: !!req.header("Authorization"),
      url: req.url,
      method: req.method,
      origin: req.headers.origin,
    });

    const authHeader = req.header("Authorization");
    if (!token && authHeader) {
      token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;
    }

    if (!token) {
      logger.warn("No token provided", {
        url: req.url,
        cookies: req.cookies ? Object.keys(req.cookies) : [],
        hasAuthHeader: !!authHeader,
      });
      throw new ApiError(401, "Unauthorized request");
    }

    try {
      if (await isTokenBlacklisted(token)) {
        throw new ApiError(401, "Token has been invalidated");
      }
    } catch (cacheError) {
      console.warn("Cache check failed, proceeding:", cacheError.message);
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    let user;
    try {
      user = await getCachedUser(decodedToken._id);
    } catch (cacheError) {
      console.warn("Cache retrieval failed:", cacheError.message);
    }

    if (!user) {
      user = await User.findById(decodedToken._id).select("-password -refreshToken -security.passwordHistory").lean();
      if (!user) {
        throw new ApiError(401, "Invalid Access Token");
      }
      try {
        await setCachedUser(decodedToken._id, user);
      } catch (cacheError) {
        console.warn("Cache storage failed:", cacheError.message);
      }
    }

    if (!user.isActive) {
      throw new ApiError(401, "Account is deactivated");
    }

    req.user = user;
    req.token = token;

    logger.info("✅ Auth Success", {
      userId: user._id,
      username: user.username,
    });
    next();
  } catch (error) {
    // Auto-refresh token if expired and refresh token exists
    if (error instanceof jwt.TokenExpiredError && req.cookies?.refreshToken) {
      logger.info("🔄 Access token expired, attempting auto-refresh", {
        url: req.url,
        hasRefreshToken: !!req.cookies.refreshToken,
      });

      try {
        const refreshToken = req.cookies.refreshToken;
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

        const user = await User.findById(decoded._id).select("-password -security.passwordHistory");
        if (!user || !user.isActive || user.refreshToken !== refreshToken) {
          throw new ApiError(401, "Invalid refresh token");
        }

        const newAccessToken = user.generateAccessToken();
        const newRefreshToken = user.generateRefreshToken();

        user.refreshToken = newRefreshToken;
        await user.save({ validateBeforeSave: false });

        res.cookie("accessToken", newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 24 * 60 * 60 * 1000,
        });

        res.cookie("refreshToken", newRefreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        req.user = user.toObject();
        delete req.user.refreshToken;
        req.token = newAccessToken;

        logger.info("✅ Token auto-refreshed successfully", {
          userId: user._id,
          username: user.username,
        });

        return next();
      } catch (refreshError) {
        logger.error("❌ Token refresh failed", {
          error: refreshError.message,
          url: req.url,
        });
        throw new ApiError(401, "Session expired. Please login again.");
      }
    }

    logger.error("❌ Auth Failed", error.message, {
      url: req.url,
      method: req.method,
      hasCookies: !!req.cookies,
    });

    if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "Invalid Access Token");
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, "Access Token Expired");
    }
    throw error;
  }
});

// Optional auth middleware with enterprise fallback
export const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    let token = req.cookies?.accessToken;

    const authHeader = req.header("Authorization");
    if (!token && authHeader) {
      token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;
    }

    if (!token) {
      req.user = null;
      return next();
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    let user;

    try {
      user = await getCachedUser(decodedToken._id);
    } catch (cacheError) {
      console.warn("Optional auth cache failed:", cacheError.message);
    }

    if (!user) {
      user = await User.findById(decodedToken._id).select("-password -refreshToken").lean();

      if (user) {
        try {
          await setCachedUser(decodedToken._id, user);
        } catch (cacheError) {
          console.warn("Optional auth cache storage failed:", cacheError.message);
        }
      }
    }

    req.user = user && user.isActive ? user : null;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
});

// Enterprise refresh token middleware (no auth required)
export const refreshTokenMiddleware = asyncHandler(async (req, res, next) => {
  // Skip auth for refresh token endpoint
  next();
});
