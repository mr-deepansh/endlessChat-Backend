// src/modules/admin/services/validation.service.js
import { ApiError } from "../../../shared/utils/ApiError.js";
import mongoose from "mongoose";

export class ValidationService {
  validatePagination(page = 1, limit = 10) {
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 10));

    return {
      page: parsedPage,
      limit: parsedLimit,
    };
  }

  validateObjectId(id, fieldName = "ID") {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, `Invalid ${fieldName}`);
    }
    return id;
  }

  sanitizeSearchQuery(query) {
    if (!query || typeof query !== "string") {
      return "";
    }

    // Remove potentially dangerous characters and limit length
    return query
      .trim()
      .replace(/[<>{}]/g, "") // Remove potential injection characters
      .substring(0, 100); // Limit length
  }

  validateUserFilters(filters) {
    const validFilters = {};

    if (filters.role && ["user", "admin", "moderator"].includes(filters.role)) {
      validFilters.role = filters.role;
    }

    if (filters.isActive !== undefined) {
      validFilters.isActive = Boolean(filters.isActive);
    }

    if (filters.createdAt) {
      try {
        if (filters.createdAt.$gte) {
          validFilters.createdAt = { $gte: new Date(filters.createdAt.$gte) };
        }
        if (filters.createdAt.$lte) {
          validFilters.createdAt = {
            ...validFilters.createdAt,
            $lte: new Date(filters.createdAt.$lte),
          };
        }
      } catch (error) {
        console.warn("Invalid date filter:", error.message);
      }
    }

    return validFilters;
  }

  validateBulkAction(action, data = {}) {
    const validActions = ["activate", "suspend", "delete", "updateRole", "verify"];

    if (!validActions.includes(action)) {
      throw new ApiError(400, `Invalid action. Valid actions: ${validActions.join(", ")}`);
    }

    if (action === "updateRole" && !data.role) {
      throw new ApiError(400, "Role is required for updateRole action");
    }

    if (action === "suspend" && !data.reason) {
      throw new ApiError(400, "Reason is required for suspend action");
    }

    return true;
  }

  validateNotificationData(data) {
    const { title, message, type, priority, channels } = data;

    if (!title && !message) {
      throw new ApiError(400, "Title or message is required");
    }

    const validTypes = ["info", "warning", "error", "success"];
    if (type && !validTypes.includes(type)) {
      throw new ApiError(400, `Invalid type. Valid types: ${validTypes.join(", ")}`);
    }

    const validPriorities = ["low", "normal", "high", "urgent"];
    if (priority && !validPriorities.includes(priority)) {
      throw new ApiError(400, `Invalid priority. Valid priorities: ${validPriorities.join(", ")}`);
    }

    const validChannels = ["email", "sms", "push", "in-app"];
    if (channels && Array.isArray(channels)) {
      const invalidChannels = channels.filter((ch) => !validChannels.includes(ch));
      if (invalidChannels.length > 0) {
        throw new ApiError(400, `Invalid channels: ${invalidChannels.join(", ")}`);
      }
    }

    return true;
  }
}
