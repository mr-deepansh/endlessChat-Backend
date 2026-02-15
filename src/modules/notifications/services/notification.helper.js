// src/modules/notifications/services/notification.helper.js
import { NotificationService } from "./notification.service.js";

const notificationService = new NotificationService();

export class NotificationHelper {
  /**
   * Create notification for post like
   */
  static async createLikeNotification(postId, postOwnerId, likerId, likerData) {
    if (postOwnerId.toString() === likerId.toString()) {
      return;
    } // Don't notify self

    // Ensure we have proper user data
    const userName = likerData?.firstName || likerData?.username || "Someone";

    const notificationData = {
      recipient: postOwnerId, // Person who owns the post (receives notification)
      sender: likerId, // Person who liked the post (sends notification)
      type: "like",
      title: `${userName} liked your post`,
      message: `${userName} liked your post`,
      data: {
        postId,
        userId: likerId, // This should be the liker, not the post owner
        actionUrl: `/posts/${postId}`,
        metadata: {
          action: "like",
          timestamp: new Date(),
        },
      },
      priority: "low",
    };

    return await notificationService.createNotification(notificationData);
  }

  /**
   * Create notification for post comment
   */
  static async createCommentNotification(postId, postOwnerId, commenterId, commenterData, commentText) {
    if (postOwnerId.toString() === commenterId.toString()) {
      return;
    } // Don't notify self

    const notificationData = {
      recipient: postOwnerId,
      sender: commenterId,
      type: "comment",
      title: `${commenterData.username} commented on your post`,
      message: `${commenterData.firstName || commenterData.username}: ${commentText.substring(0, 50)}${commentText.length > 50 ? "..." : ""}`,
      data: {
        postId,
        userId: commenterId,
        actionUrl: `/posts/${postId}#comments`,
        metadata: {
          action: "comment",
          commentPreview: commentText.substring(0, 100),
          timestamp: new Date(),
        },
      },
      priority: "medium",
    };

    return await notificationService.createNotification(notificationData);
  }

  /**
   * Create notification for follow
   */
  static async createFollowNotification(followedUserId, followerId, followerData) {
    if (followedUserId.toString() === followerId.toString()) {
      return;
    } // Don't notify self

    const notificationData = {
      recipient: followedUserId,
      sender: followerId,
      type: "follow",
      title: `${followerData.username} started following you`,
      message: `${followerData.firstName || followerData.username} started following you`,
      data: {
        userId: followerId,
        actionUrl: `/profile/${followerData.username}`,
        metadata: {
          action: "follow",
          timestamp: new Date(),
        },
      },
      priority: "medium",
    };

    return await notificationService.createNotification(notificationData);
  }

  /**
   * Create notification for mention in post/comment
   */
  static async createMentionNotification(
    mentionedUserId,
    mentionerId,
    mentionerData,
    content,
    postId = null,
    commentId = null,
  ) {
    if (mentionedUserId.toString() === mentionerId.toString()) {
      return;
    } // Don't notify self

    const isComment = !!commentId;
    const actionUrl = postId ? `/posts/${postId}${isComment ? "#comments" : ""}` : "/";

    const notificationData = {
      recipient: mentionedUserId,
      sender: mentionerId,
      type: "mention",
      title: `${mentionerData.username} mentioned you`,
      message: `${mentionerData.firstName || mentionerData.username} mentioned you in a ${isComment ? "comment" : "post"}`,
      data: {
        postId,
        commentId,
        userId: mentionerId,
        actionUrl,
        metadata: {
          action: "mention",
          contentType: isComment ? "comment" : "post",
          contentPreview: content.substring(0, 100),
          timestamp: new Date(),
        },
      },
      priority: "high",
    };

    return await notificationService.createNotification(notificationData);
  }

  /**
   * Create notification for new post from followed user
   */
  static async createNewPostNotification(postId, authorId, authorData, followerId, postTitle) {
    const notificationData = {
      recipient: followerId,
      sender: authorId,
      type: "post",
      title: `${authorData.username} shared a new post`,
      message: `${authorData.firstName || authorData.username} shared: ${postTitle.substring(0, 50)}${postTitle.length > 50 ? "..." : ""}`,
      data: {
        postId,
        userId: authorId,
        actionUrl: `/posts/${postId}`,
        metadata: {
          action: "new_post",
          postTitle: postTitle.substring(0, 100),
          timestamp: new Date(),
        },
      },
      priority: "low",
    };

    return await notificationService.createNotification(notificationData);
  }

  /**
   * Create welcome notification for new users
   */
  static async createWelcomeNotification(userId, userData) {
    const notificationData = {
      recipient: userId,
      sender: null,
      type: "welcome",
      title: `Welcome to our platform, ${userData.firstName || userData.username}!`,
      message: "Welcome! Start by following some users and sharing your first post.",
      data: {
        userId,
        actionUrl: "/explore",
        metadata: {
          action: "welcome",
          timestamp: new Date(),
        },
      },
      priority: "medium",
    };

    return await notificationService.createNotification(notificationData);
  }

  /**
   * Create system notification for all users
   */
  static async createSystemNotificationForAll(title, message, data = {}) {
    // This would typically be called from admin panel
    // For now, we'll create a method that can be used by admin services
    return await notificationService.createSystemNotification(
      [], // Will be populated by the service
      title,
      message,
      data,
    );
  }

  /**
   * Create security notification
   */
  static async createSecurityNotification(userId, action, details = {}) {
    const notificationData = {
      recipient: userId,
      sender: null,
      type: "security",
      title: `Security Alert: ${action}`,
      message: `We detected a security event on your account: ${action}`,
      data: {
        userId,
        actionUrl: "/settings/security",
        metadata: {
          action: "security_alert",
          securityAction: action,
          details,
          timestamp: new Date(),
        },
      },
      priority: "urgent",
    };

    return await notificationService.createNotification(notificationData);
  }

  /**
   * Batch create notifications (for performance)
   */
  static async createBatchNotifications(notifications) {
    const promises = notifications.map((notification) => notificationService.createNotification(notification));

    return await Promise.allSettled(promises);
  }
}
