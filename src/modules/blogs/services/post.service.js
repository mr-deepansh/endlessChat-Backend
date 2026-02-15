// src/modules/blogs/services/post.service.js
import mongoose from "mongoose";
import { Post } from "../models/index.js";
import { CacheService } from "../../../shared/utils/Cache.js";
import { ApiError } from "../../../shared/utils/ApiError.js";
import { User } from "../../users/models/user.model.js";
import { Logger } from "../../../shared/utils/Logger.js";
import { POST_STATUS, POST_VISIBILITY, CACHE_TTL, CACHE_PREFIXES } from "../../../shared/constants/post.constants.js";
import { deleteFromCloudinary } from "../../../shared/services/cloudinary.service.js";

const logger = new Logger("PostService");

export class PostService {
  // Creates a new post.
  static async createPost(postData, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const post = new Post({
        ...postData,
        author: userId,
        metadata: {
          ...postData.metadata,
          device: postData.metadata?.device?.substring(0, 200) || "unknown",
          language: postData.metadata?.language?.substring(0, 50) || "en",
        },
      });
      await post.save({ session });
      // Invalidate caches
      await Promise.all([
        CacheService.del(`${CACHE_PREFIXES.USER}:${userId}`),
        CacheService.del(`${CACHE_PREFIXES.POSTS_BY_USER}:${userId}:*`),
      ]);
      await session.commitTransaction();
      logger.info("Post created successfully", { postId: post._id, userId });
      return post;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error creating post", { error, userId });
      throw new ApiError(500, "Failed to create post");
    } finally {
      session.endSession();
    }
  }
  // Retrieves posts created by the authenticated user.
  static async getMyPosts(userId, page = 1, limit = 20, status = null) {
    const cacheKey = `${CACHE_PREFIXES.POSTS_BY_USER}:${userId}:${page}:${limit}:${status || "all"}`;
    const cachedPosts = await CacheService.get(cacheKey);
    if (cachedPosts) {
      return cachedPosts;
    }
    const query = {
      author: userId,
      isDeleted: { $ne: true },
    };
    if (status && Object.values(POST_STATUS).includes(status)) {
      query.status = status;
    }
    const skip = (page - 1) * limit;
    const [posts, total] = await Promise.all([
      Post.find(query)
        .populate("author", "username firstName lastName avatar")
        .populate("media")
        .select("title content type status visibility createdAt updatedAt engagement media tags slug images videos")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments(query),
    ]);
    const result = {
      posts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
    await CacheService.set(cacheKey, result, CACHE_TTL.MEDIUM);
    return result;
  }
  // Retrieves a post by its ID.
  static async getPostById(postId) {
    const cacheKey = `${CACHE_PREFIXES.POST}:${postId}`;
    let post = await CacheService.get(cacheKey);
    if (!post) {
      post = await Post.findById(postId)
        .populate("author", "username firstName lastName avatar")
        .populate("media")
        .lean();
      if (post) {
        await CacheService.set(cacheKey, post, CACHE_TTL.MEDIUM);
      }
    }
    if (!post) {
      throw new ApiError(404, "Post not found");
    }
    return post;
  }
  // Retrieves a post by the author's username and the post ID.
  static async getPostByUsernameAndId(username, postId) {
    const cacheKey = `${CACHE_PREFIXES.POST_BY_USERNAME_AND_ID}:${username}:${postId}`;
    let post = await CacheService.get(cacheKey);
    if (!post) {
      const user = await User.findOne({ username: username.toLowerCase() }).select("_id").lean();
      if (!user) {
        throw new ApiError(404, "User not found");
      }
      post = await Post.findOne({ _id: postId, author: user._id })
        .populate("author", "username firstName lastName avatar")
        .populate("media")
        .lean();
      if (post) {
        await CacheService.set(cacheKey, post, CACHE_TTL.MEDIUM);
      }
    }
    if (!post) {
      throw new ApiError(404, "Post not found");
    }
    return post;
  }
  // Updates a post.
  static async updatePost(postId, updateData, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const post = await Post.findById(postId).session(session);
      if (!post) {
        throw new ApiError(404, "Post not found");
      }
      if (post.author.toString() !== userId.toString()) {
        throw new ApiError(403, "Access denied");
      }
      // Whitelist fields that can be updated
      const allowedUpdates = ["title", "content", "tags", "status", "visibility", "scheduledAt", "metadata"];
      const filteredUpdateData = Object.keys(updateData)
        .filter((key) => allowedUpdates.includes(key))
        .reduce((obj, key) => {
          obj[key] = updateData[key];
          return obj;
        }, {});
      const updatedPost = await Post.findByIdAndUpdate(
        postId,
        { $set: filteredUpdateData },
        { new: true, runValidators: true, session },
      ).populate("author", "username firstName lastName avatar");
      // Invalidate caches
      await Promise.all([
        CacheService.del(`${CACHE_PREFIXES.POST}:${postId}`),
        CacheService.del(`${CACHE_PREFIXES.POSTS_BY_USER}:${userId}:*`),
        CacheService.del(`${CACHE_PREFIXES.POST_BY_USERNAME_AND_ID}:${updatedPost.author.username}:${postId}`),
      ]);
      await session.commitTransaction();
      logger.info("Post updated successfully", { postId, userId });
      return updatedPost;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error updating post", { error, postId, userId });
      throw new ApiError(500, "Failed to update post");
    } finally {
      session.endSession();
    }
  }
  // Deletes a post.
  static async deletePost(postId, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const post = await Post.findById(postId).session(session);
      if (!post) {
        throw new ApiError(404, "Post not found");
      }
      if (post.author.toString() !== userId.toString()) {
        throw new ApiError(403, "Access denied");
      }

      // Clean up Cloudinary images before deleting post
      if (post.images && post.images.length > 0) {
        const deletePromises = post.images
          .map((image) => {
            if (image.publicId) {
              return deleteFromCloudinary(image.publicId).catch((err) =>
                logger.warn("Failed to delete image from Cloudinary", { publicId: image.publicId, error: err.message }),
              );
            }
          })
          .filter(Boolean);
        await Promise.all(deletePromises);
      }

      await Post.findByIdAndDelete(postId, { session });

      // Invalidate caches
      await Promise.all([
        CacheService.del(`${CACHE_PREFIXES.POST}:${postId}`),
        CacheService.del(`${CACHE_PREFIXES.POSTS_BY_USER}:${userId}:*`),
        CacheService.del(`${CACHE_PREFIXES.POST_BY_USERNAME_AND_ID}:${post.author.username}:${postId}`),
      ]);

      await session.commitTransaction();
      logger.info("Post deleted successfully", { postId, userId });
      return true;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error deleting post", { error, postId, userId });
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(500, "Failed to delete post");
    } finally {
      session.endSession();
    }
  }

  // Deletes a post by username and post ID.
  static async deletePostByUsernameAndId(username, postId, userId) {
    try {
      logger.info("Starting delete post by username and ID", { username, postId, userId });

      // Find the user by username
      const user = await User.findOne({ username: username.toLowerCase() }).select("_id username");
      if (!user) {
        logger.warn("User not found for deletion", { username });
        throw new ApiError(404, "User not found");
      }

      // Find the post
      const post = await Post.findOne({ _id: postId, author: user._id });
      if (!post) {
        logger.warn("Post not found for deletion", { postId, userId: user._id });
        throw new ApiError(404, "Post not found");
      }

      // Verify ownership
      if (post.author.toString() !== userId.toString()) {
        logger.warn("Access denied for post deletion", {
          postAuthor: post.author.toString(),
          requestingUser: userId.toString(),
        });
        throw new ApiError(403, "Access denied - You can only delete your own posts");
      }

      // Clean up Cloudinary images
      if (post.images && post.images.length > 0) {
        try {
          const deletePromises = post.images
            .map((image) => {
              if (image.publicId) {
                return deleteFromCloudinary(image.publicId).catch((err) =>
                  logger.warn("Failed to delete image from Cloudinary", {
                    publicId: image.publicId,
                    error: err.message,
                  }),
                );
              }
            })
            .filter(Boolean);
          await Promise.all(deletePromises);
        } catch (cloudinaryError) {
          logger.warn("Cloudinary cleanup failed, continuing with post deletion", { error: cloudinaryError.message });
        }
      }

      // Delete the post
      await Post.findByIdAndDelete(postId);
      logger.info("Post deleted from database", { postId });

      // Invalidate caches
      try {
        await Promise.all([
          CacheService.del(`${CACHE_PREFIXES.POST}:${postId}`),
          CacheService.del(`${CACHE_PREFIXES.POSTS_BY_USER}:${userId}:*`),
          CacheService.del(`${CACHE_PREFIXES.POST_BY_USERNAME_AND_ID}:${username}:${postId}`),
        ]);
      } catch (cacheError) {
        logger.warn("Cache invalidation failed", { error: cacheError.message });
      }

      logger.info("Post deleted successfully by username and ID", { postId, username, userId });
      return true;
    } catch (error) {
      logger.error("Error deleting post by username and ID", {
        error: error.message,
        stack: error.stack,
        postId,
        username,
        userId,
      });
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(500, `Failed to delete post: ${error.message}`);
    }
  }
  // Retrieves posts with optional filters and pagination.
  static async getPosts(filters = {}, page = 1, limit = 20) {
    const query = {
      status: POST_STATUS.PUBLISHED,
      visibility: POST_VISIBILITY.PUBLIC,
      isDeleted: { $ne: true },
    };
    // Whitelist and apply filters to prevent NoSQL injection
    const allowedFilters = ["tags", "author", "type"];
    Object.keys(filters).forEach((key) => {
      if (allowedFilters.includes(key) && filters[key]) {
        if (key === "tags") {
          query.tags = { $in: filters[key].split(",").map((tag) => tag.trim()) };
        } else {
          query[key] = filters[key];
        }
      }
    });
    const sortBy = filters.sortBy || "createdAt";
    const sortOrder = filters.sortOrder === "asc" ? 1 : -1;
    const skip = (page - 1) * limit;
    const [posts, total] = await Promise.all([
      Post.find(query)
        .populate("author", "username firstName lastName avatar")
        .populate("media")
        .select(
          "title content type status visibility createdAt updatedAt engagement media tags slug images videos author",
        )
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments(query),
    ]);
    return {
      posts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }
  // Retrieves posts by a user's username.
  static async getUserPostsByUsername(username, page = 1, limit = 12) {
    const user = await User.findOne({
      username: username.toLowerCase(),
    })
      .select("_id username firstName lastName avatar")
      .lean();
    if (!user) {
      return null;
    }
    const query = {
      author: user._id,
      status: POST_STATUS.PUBLISHED,
      visibility: POST_VISIBILITY.PUBLIC,
      isDeleted: { $ne: true },
    };
    const skip = (page - 1) * limit;
    const [posts, total] = await Promise.all([
      Post.find(query)
        .select("title content type createdAt engagement slug images videos")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments(query),
    ]);
    return {
      user: {
        id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar || "/assets/default-avatar.png",
      },
      posts: posts.map((post) => ({
        id: post._id,
        title: post.title,
        content:
          post.content && post.content.length > 150 ? `${post.content.substring(0, 150)}...` : post.content || "",
        type: post.type,
        createdAt: post.createdAt,
        engagement: {
          likes: post.engagement?.likeCount || 0,
          comments: post.engagement?.commentCount || 0,
          shares: post.engagement?.shareCount || 0,
          views: post.engagement?.viewCount || 0,
        },
        slug: post.slug,
        images: post.images || [],
        videos: post.videos || [],
      })),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }
}
