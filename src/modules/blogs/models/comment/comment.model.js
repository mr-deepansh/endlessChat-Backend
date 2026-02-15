// src/modules/blogs/models/comment/comment.model.js
import mongoose, { Schema } from "mongoose";
import { baseSchema, baseOptions, metadataSchema, auditSchema } from "../shared/base.model.js";

// Mention schema for @mentions
const mentionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startIndex: { type: Number, required: true },
    endIndex: { type: Number, required: true },
  },
  { _id: false },
);

// Comment schema
const commentSchema = new Schema(
  {
    ...baseSchema,
    content: { type: String, required: true, trim: true, maxlength: 1000 },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    parentComment: { type: Schema.Types.ObjectId, ref: "Comment", index: true },

    // Nested comments structure
    replies: [{ type: Schema.Types.ObjectId, ref: "Comment" }],
    replyCount: { type: Number, default: 0 },
    depth: { type: Number, default: 0, max: 5 }, // limit nesting depth

    // Engagement
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    likeCount: { type: Number, default: 0 },

    // Content features
    mentions: [mentionSchema],
    hashtags: [String],

    // Moderation
    isEdited: { type: Boolean, default: false },
    editedAt: Date,
    editReason: String,
    isHidden: { type: Boolean, default: false },
    hiddenReason: String,
    isPinned: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,

    // Analytics
    reportCount: { type: Number, default: 0 },

    // Metadata
    metadata: metadataSchema,
    auditLog: [auditSchema],
  },
  baseOptions,
);

// Indexes for performance
commentSchema.index({ post: 1, createdAt: -1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1, createdAt: 1 });
commentSchema.index({ post: 1, isPinned: -1, createdAt: -1 });
commentSchema.index({ hashtags: 1 });

// Virtuals
commentSchema.virtual("isReply").get(function () {
  return !!this.parentComment;
});

commentSchema.virtual("engagementRate").get(function () {
  // Calculate based on likes vs views (if tracking comment views)
  return this.likeCount;
});

// Pre-save middleware
commentSchema.pre("save", function (next) {
  // Extract hashtags
  if (this.isModified("content")) {
    this.hashtags = this.content.match(/#\w+/g) || [];
    this.hashtags = this.hashtags.map((tag) => tag.toLowerCase());
  }

  // Set depth for nested comments
  if (this.parentComment && this.isNew) {
    Comment.findById(this.parentComment)
      .then((parent) => {
        if (parent) {
          this.depth = (parent.depth || 0) + 1;
        }
        next();
      })
      .catch(next);
  } else {
    next();
  }
});

// Post-save middleware to update reply count
commentSchema.post("save", async (doc) => {
  if (doc.parentComment) {
    await Comment.findByIdAndUpdate(doc.parentComment, {
      $inc: { replyCount: 1 },
      $push: { replies: doc._id },
    });
  }
});

export const Comment = mongoose.model("Comment", commentSchema);
