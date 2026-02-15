// src/modules/blogs/services/notification.service.js
import { Post, Comment } from "../models/index.js";
import { Logger } from "../../../shared/utils/Logger.js";

const logger = new Logger("NotificationService");

class NotificationService {
  // Send notification for new like
  async notifyLike(postId, likedByUserId) {
    try {
      const post = await Post.findById(postId).populate("author", "fullName username email");
      if (!post || post.author._id.toString() === likedByUserId.toString()) {
        return;
      }

      const notification = {
        type: "like",
        recipient: post.author._id,
        actor: likedByUserId,
        post: postId,
        message: `Someone liked your post: "${post.title?.substring(0, 50) || post.content.substring(0, 50)}..."`,
      };

      logger.info("Like notification created:", notification);
    } catch (error) {
      logger.error("Error sending like notification:", error);
    }
  }

  // Send notification for new comment
  async notifyComment(postId, commentId, commentedByUserId) {
    try {
      const [post, comment] = await Promise.all([
        Post.findById(postId).populate("author", "fullName username email"),
        Comment.findById(commentId).populate("author", "fullName username"),
      ]);

      if (!post || !comment) {
        return;
      }

      if (post.author._id.toString() !== commentedByUserId.toString()) {
        const notification = {
          type: "comment",
          recipient: post.author._id,
          actor: commentedByUserId,
          post: postId,
          comment: commentId,
          message: `${comment.author.fullName} commented on your post: "${comment.content.substring(0, 50)}..."`,
        };

        logger.info("Comment notification created:", notification);
      }
    } catch (error) {
      logger.error("Error sending comment notification:", error);
    }
  }

  // Check for milestone achievements
  async checkMilestones(postId, engagementType, newCount) {
    const milestones = {
      likes: [10, 50, 100, 500, 1000, 5000, 10000],
      views: [100, 500, 1000, 5000, 10000, 50000, 100000],
      comments: [5, 25, 50, 100, 500, 1000],
      shares: [5, 25, 50, 100, 500, 1000],
    };

    const relevantMilestones = milestones[engagementType] || [];
    const achievedMilestone = relevantMilestones.find((milestone) => newCount >= milestone && newCount - 1 < milestone);

    if (achievedMilestone) {
      await this.notifyMilestone(postId, engagementType, achievedMilestone);
    }
  }

  // Send milestone notification
  async notifyMilestone(postId, milestone, count) {
    try {
      const post = await Post.findById(postId).populate("author", "fullName username email");
      if (!post) {
        return;
      }

      const notification = {
        type: "milestone",
        recipient: post.author._id,
        post: postId,
        message: `Congratulations! Your post reached ${count} ${milestone}!`,
      };

      logger.info("Milestone notification created:", notification);
    } catch (error) {
      logger.error("Error sending milestone notification:", error);
    }
  }
}

export default new NotificationService();
