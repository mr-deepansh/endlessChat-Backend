// src/modules/blogs/models/post/post.model.js
import mongoose, { Schema } from "mongoose";
import { baseSchema, baseOptions, metadataSchema, auditSchema } from "../shared/base.model.js";
import { User } from "../../../users/models/user.model.js";

// Location schema
const locationSchema = new Schema(
  {
    name: String,
    coordinates: { type: [Number] },
    address: String,
    city: String,
    country: String,
    placeId: String,
  },
  { _id: false },
);

// Poll option schema
const pollOptionSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 100 },
    voteCount: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
  },
  { _id: false },
);

// Poll schema
const pollSchema = new Schema(
  {
    question: { type: String, required: true, maxlength: 200 },
    options: {
      type: [pollOptionSchema],
      validate: {
        validator: (v) => v.length >= 2 && v.length <= 10,
        message: "Poll must have 2-10 options",
      },
    },
    allowMultiple: { type: Boolean, default: false },
    endsAt: Date,
    totalVotes: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

// Engagement schema
const engagementCountersSchema = new Schema(
  {
    likeCount: { type: Number, default: 0, min: 0, index: true },
    commentCount: { type: Number, default: 0, min: 0, index: true },
    shareCount: { type: Number, default: 0, min: 0 },
    repostCount: { type: Number, default: 0, min: 0 },
    bookmarkCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0, index: true },
    uniqueViewCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

// Reach schema
const reachSchema = new Schema(
  {
    organic: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    viral: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false },
);

// Main Post schema
const postSchema = new Schema(
  {
    ...baseSchema,

    title: { type: String, trim: true, maxlength: 280 },
    content: { type: String, trim: true, maxlength: 10000 },
    excerpt: { type: String, maxlength: 300 },

    type: {
      type: String,
      enum: ["post", "poll", "media", "quote", "article", "text"],
      default: "post",
      index: true,
    },
    category: {
      type: String,
      enum: ["general", "tech", "business", "lifestyle", "news", "announcement", "internal"],
      default: "general",
      index: true,
    },
    tags: [{ type: String, trim: true, maxlength: 50, lowercase: true }],
    hashtags: [{ type: String, lowercase: true }],

    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    coAuthors: [{ type: Schema.Types.ObjectId, ref: "User" }],

    status: {
      type: String,
      enum: ["draft", "published", "scheduled", "archived", "deleted"],
      default: "draft",
      index: true,
    },
    visibility: {
      type: String,
      enum: ["public", "followers", "private", "unlisted"],
      default: "public",
      index: true,
    },
    isPublic: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false, index: true },
    isPinned: { type: Boolean, default: false },

    scheduledAt: { type: Date, index: true },
    publishedAt: { type: Date, index: true },
    expiresAt: Date,

    media: [{ type: Schema.Types.ObjectId, ref: "Media" }],
    thumbnail: String,

    images: [{ url: String, publicId: String }],
    videos: [{ url: String, publicId: String }],

    location: locationSchema,
    poll: pollSchema,

    quotedPost: { type: Schema.Types.ObjectId, ref: "Post" },
    originalPost: { type: Schema.Types.ObjectId, ref: "Post" },
    relatedPosts: [{ type: Schema.Types.ObjectId, ref: "Post" }],

    engagement: { type: engagementCountersSchema, default: () => ({}) },
    reach: { type: reachSchema, default: () => ({}) },

    trendingScore: { type: Number, default: 0, index: true },
    qualityScore: { type: Number, default: 0 },

    slug: { type: String, unique: true, sparse: true },
    seoTitle: String,
    seoDescription: String,
    canonicalUrl: String,

    isModerated: { type: Boolean, default: false },
    moderationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
    },
    reportCount: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    blockReason: String,

    isEdited: { type: Boolean, default: false },
    editCount: { type: Number, default: 0 },
    lastEditedAt: Date,
    editHistory: [
      {
        editedAt: { type: Date, default: Date.now },
        previousContent: String,
        reason: String,
        editedBy: { type: Schema.Types.ObjectId, ref: "User" },
      },
    ],

    metadata: metadataSchema,
    auditLog: [auditSchema],

    lastActivityAt: { type: Date, default: Date.now, index: true },
    hotScore: { type: Number, default: 0, index: true },

    language: { type: String, default: "en" },
    translations: [
      {
        language: String,
        title: String,
        content: String,
        translatedBy: { type: Schema.Types.ObjectId, ref: "User" },
      },
    ],
  },
  baseOptions,
);

// Compound indexes
postSchema.index({ author: 1, status: 1, createdAt: -1 });
postSchema.index({ status: 1, visibility: 1, publishedAt: -1 });
postSchema.index({ type: 1, category: 1, createdAt: -1 });
postSchema.index({ tags: 1, status: 1, createdAt: -1 });
postSchema.index({ hashtags: 1, createdAt: -1 });
postSchema.index({ "engagement.likeCount": -1, createdAt: -1 });
postSchema.index({ "engagement.viewCount": -1, createdAt: -1 });
postSchema.index({ trendingScore: -1, publishedAt: -1 });
postSchema.index({ hotScore: -1, lastActivityAt: -1 });
postSchema.index({ scheduledAt: 1, status: 1 });
postSchema.index({ isFeatured: -1, publishedAt: -1 });
postSchema.index({ author: 1, isFeatured: -1, createdAt: -1 });

// Text search index
postSchema.index(
  { title: "text", content: "text", tags: "text" },
  { weights: { title: 10, content: 5, tags: 1 }, name: "content_search_index" },
);

// Geospatial index
postSchema.index({ "location.coordinates": "2dsphere" });

// Virtuals
postSchema.virtual("engagementRate").get(function () {
  if (!this.engagement.viewCount) {
    return 0;
  }
  const total = this.engagement.likeCount + this.engagement.commentCount + this.engagement.shareCount;
  return Number(((total / this.engagement.viewCount) * 100).toFixed(2));
});

postSchema.virtual("isScheduled").get(function () {
  return this.status === "scheduled" && this.scheduledAt > new Date();
});

postSchema.virtual("readTime").get(function () {
  if (!this.content) {
    return 0;
  }
  const words = this.content.split(" ").length;
  return Math.ceil(words / 200);
});

// Generate unique slug
const generateUniqueSlug = async (baseSlug, postId = null) => {
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    const query = { slug };
    if (postId) {
      query._id = { $ne: postId };
    }
    const existing = await mongoose.model("Post").findOne(query);
    if (!existing) {
      return slug;
    }
    slug = `${baseSlug}-${counter++}`;
  }
};

// Pre-save middleware
postSchema.pre("save", async function (next) {
  if (this.isModified("content") && this.content && !this.excerpt) {
    this.excerpt = `${this.content.substring(0, 297)}...`;
  }
  if (this.isModified("content")) {
    this.hashtags = (this.content.match(/#\w+/g) || []).map((t) => t.toLowerCase().substring(1));
  }
  if (this.status === "published" && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  if ((this.isModified("title") || this.isNew) && !this.slug) {
    const baseSlug = (this.title || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    this.slug = await generateUniqueSlug(baseSlug || "untitled", this._id);
  }
  this.lastActivityAt = new Date();
  next();
});

export const Post = mongoose.model("Post", postSchema);
