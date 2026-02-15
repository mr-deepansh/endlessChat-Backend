// src/shared/middleware/superAdmin.middleware.js
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/AsyncHandler.js";
import { USER_ROLES } from "../constants/app.constants.js";

/**
 * Middleware to ensure only super_admin role can access certain routes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const isSuperAdmin = asyncHandler(async (req, res, next) => {
  if (!req.user?.role) {
    throw new ApiError(401, "Authentication required");
  }

  if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(403, "Super admin access required");
  }

  next();
});

/**
 * Middleware for role-based access control with hierarchy
 * @param {string} minimumRole - Minimum role required
 */
export const requireRole = (minimumRole) => {
  return asyncHandler(async (req, res, next) => {
    if (!req.user?.role) {
      throw new ApiError(401, "Authentication required");
    }

    const roleHierarchy = {
      [USER_ROLES.USER]: 1,
      [USER_ROLES.ADMIN]: 2,
      [USER_ROLES.SUPER_ADMIN]: 3,
    };

    const userLevel = roleHierarchy[req.user.role] || 0;
    const requiredLevel = roleHierarchy[minimumRole] || 0;

    if (userLevel < requiredLevel) {
      throw new ApiError(403, `${minimumRole} privileges required`);
    }

    next();
  });
};
