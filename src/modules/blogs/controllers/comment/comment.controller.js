// src/modules/blogs/controllers/comment/comment.controller.js
import { Comment, Post } from "../../models/index.js";
import { asyncHandler } from "../../../../shared/utils/AsyncHandler.js";
import { ApiError } from "../../../../shared/utils/ApiError.js";
import { ApiResponse } from "../../../../shared/utils/ApiResponse.js";
import { safeAsyncOperation, handleControllerError } from "../../../../shared/utils/ErrorHandler.js";
import { calculateApiHealth } from "../../../../shared/utils/ApiHealth.js";
import { Logger } from "../../../../shared/utils/Logger.js";
import { NotificationHelper } from "../../../notifications/services/notification.helper.js";
import mongoose from "mongoose";

const logger = new Logger("CommentController");

// Add comment
const addComment = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { postId } = req.params;
  const { content, parentCommentId } = req.body;
  const userId = req.user._id;

  try {
    // Validation
    if (!content?.trim() || content.trim().length < 1) {
      throw new ApiError(400, "Comment content is required");
    }

    if (content.trim().length > 1000) {
      throw new ApiError(400, "Comment too long (max 1000 characters)");
    }

    // Create comment without transaction for better performance
    const commentData = {
      content: content.trim(),
      author: userId,
      post: postId,
      parentComment: parentCommentId || null,
      metadata: {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      },
    };

    const comment = await Comment.create(commentData);

    // Update post comment count and get post details for notification
    const post = await Post.findByIdAndUpdate(postId, { $inc: { "engagement.commentCount": 1 } }, { new: true })
      .populate("author", "username firstName lastName")
      .lean();

    // Create notification for post owner (async, don't wait)
    if (post && post.author && post.author._id.toString() !== userId.toString()) {
      setImmediate(async () => {
        try {
          await NotificationHelper.createCommentNotification(postId, post.author._id, userId, req.user, content.trim());
        } catch (notifError) {
          logger.error("Failed to create comment notification:", notifError);
        }
      });
    }

    // Check for mentions in comment and create notifications
    const mentionRegex = /@([a-zA-Z0-9_]+)/g;
    const mentions = content.match(mentionRegex);
    if (mentions && mentions.length > 0) {
      setImmediate(async () => {
        try {
          // This would require a User model import and lookup
          // For now, just log the mentions
          logger.info("Mentions found in comment:", mentions);
          // TODO: Implement mention notifications
        } catch (error) {
          logger.error("Failed to process mentions:", error);
        }
      });
    }

    const populatedComment = await Comment.findById(comment._id).populate(
      "author",
      "firstName lastName fullName username avatar",
    );

    const executionTime = Date.now() - startTime;
    logger.info("Comment added", {
      commentId: comment._id,
      postId,
      userId,
      isReply: !!parentCommentId,
      executionTime,
    });

    res.status(201).json(
      new ApiResponse(
        201,
        {
          ...populatedComment.toObject(),
          meta: {
            executionTime: `${executionTime}ms`,
            apiHealth: calculateApiHealth(executionTime),
          },
        },
        "Comment added successfully",
      ),
    );
  } catch (error) {
    handleControllerError(error, req, res, startTime, logger);
  }
});

// Get comments
const getComments = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { postId } = req.params;
  const { page = 1, limit = 20, sortBy = "createdAt", sortOrder = "desc" } = req.query;

  try {
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    // Optimized query without nested populate for better performance
    const [comments, total] = await Promise.all([
      Comment.find({ post: postId, parentComment: null })
        .populate("author", "firstName lastName fullName username avatar")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Comment.countDocuments({ post: postId, parentComment: null }),
    ]);

    const executionTime = Date.now() - startTime;

    res.status(200).json(
      new ApiResponse(
        200,
        {
          comments,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalComments: total,
          },
          meta: {
            executionTime: `${executionTime}ms`,
            apiHealth: calculateApiHealth(executionTime),
          },
        },
        "Comments retrieved successfully",
      ),
    );
  } catch (error) {
    handleControllerError(error, req, res, startTime, logger);
  }
});

// Like/Unlike comment
const likeComment = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { commentId } = req.params;
  const userId = req.user._id;

  try {
    const comment = await Comment.findById(commentId);
    if (!comment) {
      throw new ApiError(404, "Comment not found");
    }

    // Check if already liked
    const likeIndex = comment.likes?.indexOf(userId);
    const isLiked = likeIndex !== -1;

    if (isLiked) {
      // Unlike
      comment.likes.splice(likeIndex, 1);
      comment.likeCount = Math.max(0, (comment.likeCount || 0) - 1);
    } else {
      // Like
      if (!comment.likes) {
        comment.likes = [];
      }
      comment.likes.push(userId);
      comment.likeCount = (comment.likeCount || 0) + 1;
    }

    await comment.save();

    const executionTime = Date.now() - startTime;
    logger.info("Comment like toggled", {
      commentId,
      userId,
      isLiked: !isLiked,
      executionTime,
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          isLiked: !isLiked,
          likesCount: comment.likeCount,
          meta: {
            executionTime: `${executionTime}ms`,
            apiHealth: calculateApiHealth(executionTime),
          },
        },
        `Comment ${!isLiked ? "liked" : "unliked"} successfully`,
      ),
    );
  } catch (error) {
    handleControllerError(error, req, res, startTime, logger);
  }
});

// Delete comment
const deleteComment = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { commentId } = req.params;
  const userId = req.user._id;

  try {
    const comment = await Comment.findById(commentId);
    if (!comment) {
      throw new ApiError(404, "Comment not found");
    }

    // Check if user is the author
    if (comment.author.toString() !== userId.toString()) {
      throw new ApiError(403, "You can only delete your own comments");
    }

    // Delete comment and update post count
    await Promise.all([
      Comment.findByIdAndDelete(commentId),
      Post.findByIdAndUpdate(comment.post, { $inc: { "engagement.commentCount": -1 } }),
    ]);

    // If it's a reply, update parent comment
    if (comment.parentComment) {
      await Comment.findByIdAndUpdate(comment.parentComment, {
        $inc: { replyCount: -1 },
        $pull: { replies: commentId },
      });
    }

    const executionTime = Date.now() - startTime;
    logger.info("Comment deleted", {
      commentId,
      userId,
      executionTime,
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          meta: {
            executionTime: `${executionTime}ms`,
            apiHealth: calculateApiHealth(executionTime),
          },
        },
        "Comment deleted successfully",
      ),
    );
  } catch (error) {
    handleControllerError(error, req, res, startTime, logger);
  }
});

export { addComment, getComments, likeComment, deleteComment };
