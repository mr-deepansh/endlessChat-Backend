// src/modules/blogs/services/scheduler.service.js
import { Post } from "../models/index.js";
import cron from "node-cron";
import { Logger } from "../../../shared/utils/Logger.js";

const logger = new Logger("SchedulerService");

class SchedulerService {
  constructor() {
    this.initializeScheduler();
  }

  // Initialize cron jobs
  initializeScheduler() {
    // Check for scheduled posts every minute
    cron.schedule("* * * * *", async () => {
      await this.publishScheduledPosts();
    });

    // Clean up old analytics data daily at 2 AM
    cron.schedule("0 2 * * *", async () => {
      await this.cleanupOldAnalytics();
    });

    // Update trending posts every 15 minutes
    cron.schedule("*/15 * * * *", async () => {
      await this.updateTrendingPosts();
    });

    logger.info("Scheduler service initialized");
  }

  // Publish scheduled posts
  async publishScheduledPosts() {
    try {
      const now = new Date();
      const scheduledPosts = await Post.find({
        status: "scheduled",
        scheduledAt: { $lte: now },
      });

      for (const post of scheduledPosts) {
        await Post.findByIdAndUpdate(post._id, {
          status: "published",
          publishedAt: now,
        });

        logger.info(`Published scheduled post: ${post._id}`);
      }

      if (scheduledPosts.length > 0) {
        logger.info(`Published ${scheduledPosts.length} scheduled posts`);
      }
    } catch (error) {
      logger.error("Error publishing scheduled posts:", error);
    }
  }

  // Clean up old analytics data (keep last 90 days)
  async cleanupOldAnalytics() {
    try {
      const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      // Remove old view records but keep counts
      const result = await Post.updateMany(
        { "engagement.views.viewedAt": { $lt: cutoffDate } },
        { $pull: { "engagement.views": { viewedAt: { $lt: cutoffDate } } } },
      );

      logger.info(`Cleaned up analytics data for ${result.modifiedCount} posts`);
    } catch (error) {
      logger.error("Error cleaning up analytics:", error);
    }
  }

  // Update trending posts cache
  async updateTrendingPosts() {
    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Calculate trending score based on engagement velocity
      await Post.updateMany({ createdAt: { $gte: last24h } }, [
        {
          $set: {
            trendingScore: {
              $add: [
                { $multiply: ["$engagement.likeCount", 1] },
                { $multiply: ["$engagement.commentCount", 2] },
                { $multiply: ["$engagement.shareCount", 3] },
                { $multiply: ["$engagement.repostCount", 2] },
              ],
            },
          },
        },
      ]);

      logger.info("Updated trending posts scores");
    } catch (error) {
      logger.error("Error updating trending posts:", error);
    }
  }

  // Schedule a post
  async schedulePost(postData, scheduledAt) {
    const scheduledDate = new Date(scheduledAt);
    const now = new Date();

    if (scheduledDate <= now) {
      throw new Error("Scheduled time must be in the future");
    }

    // Maximum 1 year in advance
    const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    if (scheduledDate > maxDate) {
      throw new Error("Cannot schedule posts more than 1 year in advance");
    }

    return {
      ...postData,
      status: "scheduled",
      scheduledAt: scheduledDate,
    };
  }

  // Get user's scheduled posts
  async getScheduledPosts(userId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find({
        author: userId,
        status: "scheduled",
        scheduledAt: { $gt: new Date() },
      })
        .sort({ scheduledAt: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Post.countDocuments({
        author: userId,
        status: "scheduled",
        scheduledAt: { $gt: new Date() },
      }),
    ]);

    return {
      posts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalPosts: total,
      },
    };
  }

  // Cancel scheduled post
  async cancelScheduledPost(postId, userId) {
    const post = await Post.findOne({
      _id: postId,
      author: userId,
      status: "scheduled",
    });

    if (!post) {
      throw new Error("Scheduled post not found");
    }

    // Convert to draft
    await Post.findByIdAndUpdate(postId, {
      status: "draft",
      $unset: { scheduledAt: 1 },
    });

    return { success: true, message: "Scheduled post cancelled" };
  }

  // Reschedule post
  async reschedulePost(postId, userId, newScheduledAt) {
    const post = await Post.findOne({
      _id: postId,
      author: userId,
      status: "scheduled",
    });

    if (!post) {
      throw new Error("Scheduled post not found");
    }

    const newDate = new Date(newScheduledAt);
    const now = new Date();

    if (newDate <= now) {
      throw new Error("New scheduled time must be in the future");
    }

    await Post.findByIdAndUpdate(postId, {
      scheduledAt: newDate,
    });

    return { success: true, message: "Post rescheduled successfully" };
  }

  // Get scheduling analytics
  async getSchedulingAnalytics(userId) {
    const [scheduled, published, drafts] = await Promise.all([
      Post.countDocuments({ author: userId, status: "scheduled" }),
      Post.countDocuments({ author: userId, status: "published" }),
      Post.countDocuments({ author: userId, status: "draft" }),
    ]);

    // Best posting times based on user's published posts performance
    const bestTimes = await Post.aggregate([
      { $match: { author: userId, status: "published" } },
      {
        $group: {
          _id: {
            hour: { $hour: "$publishedAt" },
            dayOfWeek: { $dayOfWeek: "$publishedAt" },
          },
          avgEngagement: {
            $avg: {
              $add: ["$engagement.likeCount", "$engagement.commentCount", "$engagement.shareCount"],
            },
          },
          postCount: { $sum: 1 },
        },
      },
      { $match: { postCount: { $gte: 3 } } }, // Only include times with at least 3 posts
      { $sort: { avgEngagement: -1 } },
      { $limit: 5 },
    ]);

    return {
      overview: {
        scheduled,
        published,
        drafts,
        total: scheduled + published + drafts,
      },
      bestTimes: bestTimes.map((time) => ({
        hour: time._id.hour,
        dayOfWeek: time._id.dayOfWeek,
        avgEngagement: Math.round(time.avgEngagement),
        postCount: time.postCount,
      })),
    };
  }
}

export default new SchedulerService();
