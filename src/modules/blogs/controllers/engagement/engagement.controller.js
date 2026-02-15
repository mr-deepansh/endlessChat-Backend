// src/modules/blogs/controllers/engagement/engagement.controller.js
import { Like, Share, Bookmark, View } from "../../models/index.js";
import { Post } from "../../models/index.js";
import { asyncHandler } from "../../../../shared/utils/AsyncHandler.js";
import { ApiError } from "../../../../shared/utils/ApiError.js";
import { ApiResponse } from "../../../../shared/utils/ApiResponse.js";
import { safeAsyncOperation, handleControllerError } from "../../../../shared/utils/ErrorHandler.js";
import { Logger } from "../../../../shared/utils/Logger.js";
import { NotificationHelper } from "../../../notifications/services/notification.helper.js";
import mongoose from "mongoose";

const logger = new Logger("EngagementController");

// Toggle like
const toggleLike = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { postId } = req.params;
  const userId = req.user._id;
  try {
    // Validate postId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new ApiError(400, "Invalid post ID");
    }
    const existingLike = await Like.findOne({
      user: userId,
      target: postId,
      targetType: "post",
    });
    let isLiked = false;
    let post = null;
    if (existingLike) {
      // Unlike
      await Like.findByIdAndDelete(existingLike._id);
      post = await Post.findByIdAndUpdate(postId, { $inc: { "engagement.likeCount": -1 } }, { new: true }).populate(
        "author",
        "username firstName lastName",
      );
      isLiked = false;
    } else {
      // Like
      await Like.create({ user: userId, target: postId, targetType: "post" });
      post = await Post.findByIdAndUpdate(postId, { $inc: { "engagement.likeCount": 1 } }, { new: true }).populate(
        "author",
        "username firstName lastName",
      );
      isLiked = true;
      // Create notification for post owner (async, don't wait)
      if (post && post.author && post.author._id.toString() !== userId.toString()) {
        setImmediate(async () => {
          try {
            await NotificationHelper.createLikeNotification(postId, post.author._id, userId, req.user);
          } catch (notifError) {
            logger.error("Failed to create like notification:", notifError);
          }
        });
      }
    }
    if (!post) {
      throw new ApiError(404, "Post not found");
    }
    const executionTime = Date.now() - startTime;
    logger.info("Like toggled", {
      postId,
      userId: userId.toString(),
      postAuthor: post?.author?._id?.toString(),
      liked: !existingLike,
      executionTime,
    });
    res.status(200).json(
      new ApiResponse(
        200,
        {
          isLiked,
          likesCount: post?.engagement?.likeCount || 0,
          meta: { executionTime: `${executionTime}ms` },
        },
        "Like toggled successfully",
      ),
    );
  } catch (error) {
    handleControllerError(error, req, res, startTime, logger);
  }
});

// Track view
const trackView = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user?._id;
  try {
    // Create view record asynchronously
    setImmediate(async () => {
      try {
        const viewData = {
          user: userId,
          post: postId,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          device: req.headers["user-agent"],
        };
        await View.create(viewData);
        // Update post view count
        const isUniqueView = userId
          ? !(await View.findOne({ user: userId, post: postId }))
          : !(await View.findOne({ ip: req.ip, post: postId }));
        await Post.findByIdAndUpdate(postId, {
          $inc: {
            "engagement.viewCount": 1,
            ...(isUniqueView && { "engagement.uniqueViewCount": 1 }),
          },
        });
      } catch (error) {
        logger.error("View tracking failed:", error);
      }
    });
    res.status(200).json(new ApiResponse(200, { tracked: true }, "View tracked"));
  } catch (error) {
    // Don't fail the request if view tracking fails
    res.status(200).json(new ApiResponse(200, { tracked: false }, "View tracking failed"));
  }
});

// Repost functionality
const repost = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { postId } = req.params;
  const userId = req.user._id;
  const { content } = req.body; // Optional quote content
  try {
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new ApiError(400, "Invalid post ID");
    }
    const session = await mongoose.startSession();
    session.startTransaction();
    // Check if post exists
    const originalPost = await Post.findById(postId);
    if (!originalPost) {
      throw new ApiError(404, "Post not found");
    }
    // Check if user already reposted (only for simple reposts, not quotes)
    if (!content) {
      const existingRepost = await Post.findOne({
        author: userId,
        originalPost: postId,
        type: "post",
      });
      if (existingRepost) {
        await session.abortTransaction();
        session.endSession();
        return res.status(200).json(
          new ApiResponse(
            200,
            {
              isReposted: true,
              repostsCount: originalPost.engagement?.repostCount || 0,
              repost: existingRepost,
              message: "You have already reposted this post.",
            },
            "Post has already been reposted by the user.",
          ),
        );
      }
    }
    // Create repost
    const repostData = {
      author: userId,
      originalPost: postId,
      type: content ? "quote" : "post",
      status: "published",
      visibility: "public",
    };
    if (content) {
      repostData.content = content;
      repostData.title = "";
    } else {
      repostData.content = originalPost.content;
      repostData.title = originalPost.title;
    }
    const repost = await Post.create([repostData], { session });
    // Update original post repost count
    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $inc: { "engagement.repostCount": 1 } },
      { session, new: true },
    );
    await session.commitTransaction();
    session.endSession();
    const executionTime = Date.now() - startTime;
    logger.info("Post reposted", { postId, userId, executionTime });
    const populatedRepost = await Post.findById(repost[0]._id).populate("author", "username");
    const postUrl = `${process.env.FRONTEND_URL}/${populatedRepost.author.username}/post/${populatedRepost._id}`;
    res.status(201).json(
      new ApiResponse(
        201,
        {
          isReposted: true,
          repostsCount: updatedPost?.engagement?.repostCount || 0,
          repost: populatedRepost,
          postUrl,
          meta: { executionTime: `${executionTime}ms` },
        },
        content ? "Quote repost created successfully" : "Post reposted successfully",
      ),
    );
  } catch (error) {
    handleControllerError(error, req, res, startTime, logger);
  }
});

// Toggle bookmark
const toggleBookmark = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const userId = req.user._id;
  const existingBookmark = await Bookmark.findOne({
    user: userId,
    post: postId,
  });
  let isBookmarked = false;
  if (existingBookmark) {
    await Bookmark.findByIdAndDelete(existingBookmark._id);
    isBookmarked = false;
  } else {
    await Bookmark.create({ user: userId, post: postId });
    isBookmarked = true;
  }
  res.status(200).json(new ApiResponse(200, { isBookmarked }, "Bookmark toggled successfully"));
});

// Track share
const trackShare = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { postId } = req.params;
  const userId = req.user._id;
  try {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new ApiError(400, "Invalid post ID");
    }
    // Create share record
    await Share.create({
      user: userId,
      post: postId,
      sharedAt: new Date(),
    });
    // Update post share count
    const post = await Post.findByIdAndUpdate(postId, { $inc: { "engagement.shareCount": 1 } }, { new: true });
    if (!post) {
      throw new ApiError(404, "Post not found");
    }
    const executionTime = Date.now() - startTime;
    logger.info("Share tracked", { postId, userId, executionTime });
    res.status(200).json(
      new ApiResponse(
        200,
        {
          postId,
          sharesCount: post.engagement?.shareCount || 0,
          sharedBy: userId,
          meta: { executionTime: `${executionTime}ms` },
        },
        "Post shared successfully",
      ),
    );
  } catch (error) {
    handleControllerError(error, req, res, startTime, logger);
  }
});

// Get bookmarked posts
const getBookmarkedPosts = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const userId = req.user._id;
  const { page = 1, limit = 10 } = req.query;
  try {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    // Get bookmarked post IDs
    const bookmarks = await Bookmark.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("post");
    const postIds = bookmarks.map((b) => b.post);
    // Get posts with engagement data
    const posts = await Post.find({ _id: { $in: postIds } })
      .populate("author", "username firstName lastName avatar")
      .sort({ createdAt: -1 });
    // Add engagement status for each post
    const postsWithEngagement = await Promise.all(
      posts.map(async (post) => {
        const [isLiked, isBookmarked] = await Promise.all([
          Like.exists({ user: userId, target: post._id, targetType: "post" }),
          Bookmark.exists({ user: userId, post: post._id }),
        ]);
        return {
          ...post.toObject(),
          isLiked: !!isLiked,
          isBookmarked: !!isBookmarked,
          likesCount: post.engagement?.likeCount || 0,
          commentsCount: post.engagement?.commentCount || 0,
          repostsCount: post.engagement?.repostCount || 0,
          sharesCount: post.engagement?.shareCount || 0,
          viewsCount: post.engagement?.viewCount || 0,
        };
      }),
    );
    const totalBookmarks = await Bookmark.countDocuments({ user: userId });
    const executionTime = Date.now() - startTime;
    logger.info("Bookmarked posts fetched", { userId, count: posts.length, executionTime });
    res.status(200).json(
      new ApiResponse(
        200,
        {
          posts: postsWithEngagement,
          totalPosts: totalBookmarks,
          totalPages: Math.ceil(totalBookmarks / parseInt(limit)),
          currentPage: parseInt(page),
          hasNextPage: skip + posts.length < totalBookmarks,
          hasPrevPage: parseInt(page) > 1,
          meta: { executionTime: `${executionTime}ms` },
        },
        "Bookmarked posts fetched successfully",
      ),
    );
  } catch (error) {
    handleControllerError(error, req, res, startTime, logger);
  }
});

export { toggleLike, trackView, repost, toggleBookmark, trackShare, getBookmarkedPosts };
