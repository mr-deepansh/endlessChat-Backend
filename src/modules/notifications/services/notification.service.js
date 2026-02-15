import mongoose from "mongoose";
import { redisClient } from "../../../config/redis/redis.config.js";
import { ApiError } from "../../../shared/index.js";
import { Notification } from "../models/notification.model.js";

export class NotificationService {
  /**
   * Validate ObjectId format
   */
  _validateObjectId(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, "Invalid notification ID format");
    }
  }

  /**
   * Create a new notification
   */
  async createNotification(data) {
    try {
      const notification = new Notification(data);
      await notification.save();

      // Invalidate user's notification cache
      await this.invalidateUserCache(data.recipient);

      return notification;
    } catch (error) {
      console.error("Failed to create notification:", error);
      throw new ApiError(500, "Failed to create notification", error);
    }
  }

  /**
   * Invalidate user's notification cache
   */
  async invalidateUserCache(userId) {
    try {
      const cacheKeys = [`notifications:${userId}:*`, `unread_count:${userId}`];

      for (const pattern of cacheKeys) {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      }
    } catch (error) {
      console.error("Failed to invalidate notification cache:", error);
      // Don't throw error, cache invalidation failure shouldn't break the flow
    }
  }

  /**
   * Get user notifications with pagination
   */
  async getUserNotifications(userId, options = {}) {
    try {
      const { page = 1, limit = 20, type, isRead, priority } = options;

      const filter = { recipient: userId };
      if (type) {
        filter.type = type;
      }
      if (typeof isRead === "boolean") {
        filter.isRead = isRead;
      }
      if (priority) {
        filter.priority = priority;
      }

      const skip = (page - 1) * limit;

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find(filter)
          .populate("sender", "username firstName lastName avatar")
          .populate("data.postId", "title slug")
          .populate("data.userId", "username firstName lastName avatar")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Notification.countDocuments(filter),
        Notification.getUnreadCount(userId),
      ]);

      // Transform notifications to match frontend expectations
      const transformedNotifications = notifications.map((notification) => ({
        ...notification,
        from: notification.sender || {
          _id: "system",
          username: "system",
          firstName: "System",
          lastName: "Notification",
          avatar: null,
        },
      }));

      return {
        notifications: transformedNotifications,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalCount: total,
          limit,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
        unreadCount,
      };
    } catch (error) {
      throw new ApiError(500, "Failed to fetch notifications", error);
    }
  }

  /**
   * Mark notification as read - Fixed version
   */
  async markAsRead(notificationId, userId) {
    try {
      // Validate ObjectId format
      this._validateObjectId(notificationId);

      // First check if the notification exists and belongs to the user
      const existingNotification = await Notification.findOne({
        _id: notificationId,
        recipient: userId,
      });

      if (!existingNotification) {
        throw new ApiError(404, "Notification not found");
      }

      // If already read, return success with message
      if (existingNotification.isRead) {
        return {
          ...existingNotification.toObject(),
          message: "Notification was already marked as read",
        };
      }

      // Update the notification
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipient: userId, isRead: false },
        { isRead: true, readAt: new Date() },
        { new: true },
      );

      // Invalidate cache
      await this.invalidateUserCache(userId);

      return notification;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error("Failed to mark notification as read:", error);
      throw new ApiError(500, "Failed to mark notification as read", error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId) {
    try {
      const result = await Notification.markAllAsRead(userId);

      // Invalidate cache
      await this.invalidateUserCache(userId);

      return { modifiedCount: result.modifiedCount };
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
      throw new ApiError(500, "Failed to mark all notifications as read", error);
    }
  }

  /**
   * Delete notification - Fixed version
   */
  async deleteNotification(notificationId, userId) {
    try {
      // Validate ObjectId format
      this._validateObjectId(notificationId);

      const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        recipient: userId,
      });

      if (!notification) {
        throw new ApiError(404, "Notification not found");
      }

      // Invalidate cache
      await this.invalidateUserCache(userId);

      return { message: "Notification deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error("Failed to delete notification:", error);
      throw new ApiError(500, "Failed to delete notification", error);
    }
  }

  /**
   * Get unread count with caching
   */
  async getUnreadCount(userId) {
    try {
      const cacheKey = `unread_count:${userId}`;

      // Try cache first
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached !== null) {
          return { unreadCount: parseInt(cached) };
        }
      } catch (cacheError) {
        console.error("Redis cache error:", cacheError);
      }

      // Fallback to database
      const count = await Notification.getUnreadCount(userId);

      // Cache the result for 5 minutes
      try {
        await redisClient.setex(cacheKey, 300, count.toString());
      } catch (cacheError) {
        console.error("Failed to cache unread count:", cacheError);
      }

      return { unreadCount: count };
    } catch (error) {
      console.error("Failed to get unread count:", error);
      throw new ApiError(500, "Failed to get unread count", error);
    }
  }

  /**
   * Create system notification
   */
  async createSystemNotification(recipients, title, message, data = {}) {
    try {
      const notifications = recipients.map((recipientId) => ({
        recipient: recipientId,
        type: "system",
        title,
        message,
        data,
        priority: "medium",
        channel: "in-app",
      }));

      const result = await Notification.insertMany(notifications);
      return { created: result.length };
    } catch (error) {
      throw new ApiError(500, "Failed to create system notifications", error);
    }
  }

  /**
   * Clean up expired notifications
   */
  async cleanupExpiredNotifications() {
    try {
      const result = await Notification.deleteMany({
        expiresAt: { $lt: new Date() },
      });
      return { deletedCount: result.deletedCount };
    } catch (error) {
      throw new ApiError(500, "Failed to cleanup expired notifications", error);
    }
  }

  /**
   * Get notification statistics
   */
  async getNotificationStats(userId) {
    try {
      const [totalCount, unreadCount, typeStats, recentActivity] = await Promise.all([
        Notification.countDocuments({ recipient: userId }),
        Notification.getUnreadCount(userId),
        Notification.aggregate([
          { $match: { recipient: userId } },
          { $group: { _id: "$type", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Notification.find({ recipient: userId }).sort({ createdAt: -1 }).limit(5).select("type createdAt").lean(),
      ]);

      return {
        totalCount,
        unreadCount,
        typeBreakdown: typeStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        recentActivity: recentActivity.map((n) => ({
          type: n.type,
          timestamp: n.createdAt,
        })),
      };
    } catch (error) {
      throw new ApiError(500, "Failed to get notification statistics", error);
    }
  }

  /**
   * Clear all notifications for user
   */
  async clearAllNotifications(userId) {
    try {
      const result = await Notification.deleteMany({ recipient: userId });

      // Invalidate cache
      await this.invalidateUserCache(userId);

      return { deletedCount: result.deletedCount };
    } catch (error) {
      throw new ApiError(500, "Failed to clear all notifications", error);
    }
  }

  /**
   * Get user notification preferences (placeholder - would be stored in user model)
   */
  async getNotificationPreferences(userId) {
    try {
      // This would typically be stored in the user model
      // For now, returning default preferences
      return {
        email: {
          likes: true,
          comments: true,
          follows: true,
          mentions: true,
          posts: false,
          system: true,
        },
        push: {
          likes: false,
          comments: true,
          follows: true,
          mentions: true,
          posts: false,
          system: true,
        },
        inApp: {
          likes: true,
          comments: true,
          follows: true,
          mentions: true,
          posts: true,
          system: true,
        },
      };
    } catch (error) {
      throw new ApiError(500, "Failed to get notification preferences", error);
    }
  }

  /**
   * Update user notification preferences
   */
  async updateNotificationPreferences(userId, preferences) {
    try {
      // This would typically update the user model
      // For now, just return success
      return {
        message: "Notification preferences updated successfully",
        preferences,
      };
    } catch (error) {
      throw new ApiError(500, "Failed to update notification preferences", error);
    }
  }

  /**
   * Create notification for multiple users (batch)
   */
  async createBatchNotifications(notifications) {
    try {
      const result = await Notification.insertMany(notifications);
      // Invalidate cache for all affected users
      const userIds = [...new Set(notifications.map((n) => n.recipient))];
      await Promise.all(userIds.map((userId) => this.invalidateUserCache(userId)));
      return { created: result.length };
    } catch (error) {
      throw new ApiError(500, "Failed to create batch notifications", error);
    }
  }

  /**
   * Get notification by ID (helper method for debugging)
   */
  async getNotificationById(notificationId, userId) {
    try {
      this._validateObjectId(notificationId);
      const notification = await Notification.findOne({
        _id: notificationId,
        recipient: userId,
      }).populate("sender", "username firstName lastName avatar");
      if (!notification) {
        throw new ApiError(404, "Notification not found");
      }
      return notification;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(500, "Failed to get notification", error);
    }
  }
}
