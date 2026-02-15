// src/modules/blogs/controllers/post/post.controller.js
import { asyncHandler } from "../../../../shared/utils/AsyncHandler.js";
import { ApiError } from "../../../../shared/utils/ApiError.js";
import { ApiResponse } from "../../../../shared/utils/ApiResponse.js";
import { PostService } from "../../services/post.service.js";
import { Logger } from "../../../../shared/utils/Logger.js";
import { User } from "../../../users/models/user.model.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../../../../shared/services/cloudinary.service.js";
import fs from "fs/promises";

const logger = new Logger("PostController");

// Create post with media upload
const createPost = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const userId = req.user._id;
  const postData = {
    title: req.body.title || "",
    content: req.body.content,
    type: req.body.type || "post",
    category: req.body.category || "general",
    tags: req.body.tags || [],
    status: req.body.status || "published",
    visibility: req.body.visibility || "public",
    images: [],
    videos: [],
    metadata: {
      device: req.headers["user-agent"],
      ip: req.ip,
      language: req.headers["accept-language"],
      platform: req.body.metadata?.platform || "web",
    },
  };
  // Handle media uploads (parallel processing)
  const files = req.files || (req.file ? [req.file] : []);

  if (files.length > 0) {
    const uploadPromises = files.map(async (file) => {
      try {
        const result = await uploadToCloudinary(file.path, "posts");
        await fs.unlink(file.path).catch(() => {});
        return { result, mimetype: file.mimetype };
      } catch (error) {
        logger.error("File upload failed:", error);
        await fs.unlink(file.path).catch(() => {});
        return null;
      }
    });

    const uploadResults = await Promise.all(uploadPromises);

    uploadResults.forEach((upload) => {
      if (upload) {
        if (upload.mimetype.startsWith("image/")) {
          postData.images.push(upload.result);
        } else if (upload.mimetype.startsWith("video/")) {
          postData.videos.push(upload.result);
        }
      }
    });
  }
  const post = await PostService.createPost(postData, userId);
  const executionTime = Date.now() - startTime;

  logger.info("Post created", {
    postId: post._id,
    userId,
    executionTime,
    mediaCount: (postData.images?.length || 0) + (postData.videos?.length || 0),
  });
  res.status(201).json(
    new ApiResponse(201, post, "Post created successfully", true, {
      executionTime: `${executionTime}ms`,
    }),
  );
});

// Get posts with advanced filtering
const getPosts = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const filters = req.query;
  const { page = 1, limit = 20 } = req.query;
  const result = await PostService.getPosts(filters, parseInt(page), parseInt(limit));
  // Ensure all posts have engagement data
  if (result.posts) {
    result.posts = result.posts.map((post) => {
      const postData = post.toObject ? post.toObject() : post;
      if (!postData.engagement) {
        postData.engagement = {
          likeCount: 0,
          commentCount: 0,
          shareCount: 0,
          repostCount: 0,
          bookmarkCount: 0,
          viewCount: 0,
          uniqueViewCount: 0,
        };
      }
      return postData;
    });
  }
  const executionTime = Date.now() - startTime;
  res.status(200).json(
    new ApiResponse(200, result, "Posts retrieved successfully", true, {
      executionTime: `${executionTime}ms`,
    }),
  );
});

// Get single post by ID
const getPostById = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { id } = req.params;
  const post = await PostService.getPostById(id);
  if (!post) {
    throw new ApiError(404, "Post not found");
  }
  // Ensure engagement counts are included
  const postData = post.toObject ? post.toObject() : post;
  if (!postData.engagement) {
    postData.engagement = {
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      repostCount: 0,
      bookmarkCount: 0,
      viewCount: 0,
      uniqueViewCount: 0,
    };
  }
  const executionTime = Date.now() - startTime;
  res.status(200).json(
    new ApiResponse(200, postData, "Post retrieved successfully", true, {
      executionTime: `${executionTime}ms`,
    }),
  );
});

// Get single post by username and post ID
const getPostByUsernameAndId = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { username, id } = req.params;
  const post = await PostService.getPostByUsernameAndId(username, id);
  if (!post) {
    throw new ApiError(404, "Post not found");
  }
  // Ensure engagement counts are included
  const postData = post.toObject ? post.toObject() : post;
  if (!postData.engagement) {
    postData.engagement = {
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      repostCount: 0,
      bookmarkCount: 0,
      viewCount: 0,
      uniqueViewCount: 0,
    };
  }
  const executionTime = Date.now() - startTime;
  res.status(200).json(
    new ApiResponse(200, postData, "Post retrieved successfully", true, {
      executionTime: `${executionTime}ms`,
    }),
  );
});

// Update post
const updatePost = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { id } = req.params;
  const userId = req.user._id;
  const updatedPost = await PostService.updatePost(id, req.body, userId);
  const executionTime = Date.now() - startTime;
  logger.info("Post updated", { postId: id, userId, executionTime });
  res.status(200).json(
    new ApiResponse(200, updatedPost, "Post updated successfully", true, {
      executionTime: `${executionTime}ms`,
    }),
  );
});

// Delete post
const deletePost = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { id } = req.params;
  const userId = req.user._id;

  // Validate post ID format
  if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
    throw new ApiError(400, "Invalid post ID format");
  }

  try {
    await PostService.deletePost(id, userId);
    const executionTime = Date.now() - startTime;
    logger.info("Post deleted", { postId: id, userId, executionTime });

    res.status(200).json(
      new ApiResponse(200, { postId: id }, "Post deleted successfully", true, {
        executionTime: `${executionTime}ms`,
      }),
    );
  } catch (error) {
    logger.error("Delete post failed", {
      postId: id,
      userId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
});

// Delete post by username and ID
const deletePostByUsernameAndId = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { username, id } = req.params;
  const userId = req.user._id;

  // Validate inputs
  if (!username || !id) {
    throw new ApiError(400, "Username and post ID are required");
  }

  if (!id.match(/^[0-9a-fA-F]{24}$/)) {
    throw new ApiError(400, "Invalid post ID format");
  }

  try {
    await PostService.deletePostByUsernameAndId(username, id, userId);

    const executionTime = Date.now() - startTime;
    logger.info("Post deleted by username and ID", {
      postId: id,
      username,
      userId,
      executionTime,
    });

    res.status(200).json(
      new ApiResponse(200, { postId: id, username }, "Post deleted successfully", true, {
        executionTime: `${executionTime}ms`,
      }),
    );
  } catch (error) {
    logger.error("Delete post by username and ID failed", {
      postId: id,
      username,
      userId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
});

// Get current user's posts
const getMyPosts = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const userId = req.user?._id;
  if (!userId) {
    throw new ApiError(401, "Authentication required");
  }
  const { page = 1, limit = 12, status, type } = req.query;
  const result = await PostService.getMyPosts(userId, parseInt(page), parseInt(limit), status);
  // Clean response - remove sensitive data
  const cleanPosts = result.posts.map((post) => ({
    id: post._id,
    title: post.title,
    content: post.content && post.content.length > 150 ? `${post.content.substring(0, 150)}...` : post.content || "",
    type: post.type,
    status: post.status,
    visibility: post.visibility,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    engagement: {
      likes: post.engagement?.likeCount || 0,
      comments: post.engagement?.commentCount || 0,
      shares: post.engagement?.shareCount || 0,
      views: post.engagement?.viewCount || 0,
    },
    media: (post.media && post.media.length) || 0,
    tags: post.tags || [],
    slug: post.slug,
    images: post.images || [],
    videos: post.videos || [],
  }));
  const executionTime = Date.now() - startTime;
  logger.info("My posts retrieved", {
    userId,
    count: result.posts.length,
    executionTime,
  });
  res.status(200).json(
    new ApiResponse(
      200,
      {
        user: {
          id: req.user._id,
          username: req.user.username,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          avatar: req.user.avatar || "/assets/default-avatar.png",
        },
        posts: cleanPosts,
        pagination: result.pagination,
        stats: {
          total: result.pagination.total,
          drafts: cleanPosts.filter((p) => p.status === "draft").length,
          published: cleanPosts.filter((p) => p.status === "published").length,
        },
      },
      "Posts retrieved successfully",
      true,
      {
        executionTime: `${executionTime}ms`,
      },
    ),
  );
});

// Get user posts by username
const getUserPosts = asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { page = 1, limit = 12 } = req.query;
  const currentUserId = req.user?._id;
  const result = await PostService.getUserPostsByUsername(username, parseInt(page), parseInt(limit), currentUserId);
  if (!result) {
    throw new ApiError(404, "User not found");
  }
  res.status(200).json(new ApiResponse(200, result, "User posts retrieved successfully"));
});

export {
  createPost,
  getPosts,
  getPostById,
  getPostByUsernameAndId,
  updatePost,
  deletePost,
  deletePostByUsernameAndId,
  getMyPosts,
  getUserPosts,
};
