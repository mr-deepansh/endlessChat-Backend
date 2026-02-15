// src/shared/middleware/rbac.middleware.js
import { USER_ROLES, ROLE_HIERARCHY } from "../constants/app.constants.js";
import { ApiError } from "../utils/ApiError.js";

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole || !allowedRoles.includes(userRole)) {
      throw new ApiError(403, "Forbidden: Access Denied");
    }

    next();
  };
};

// Check if user has higher or equal role level
const authorizeMinimumRole = (minimumRole) => {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole) {
      throw new ApiError(401, "Authentication required");
    }

    const userRoleLevel = ROLE_HIERARCHY[userRole] || 0;
    const requiredRoleLevel = ROLE_HIERARCHY[minimumRole] || 0;

    if (userRoleLevel < requiredRoleLevel) {
      throw new ApiError(403, `Access denied. ${minimumRole} privileges required.`);
    }

    next();
  };
};

export default authorizeRoles;
export { authorizeMinimumRole };
