// src/modules/blogs/models/shared/base.model.js
import mongoose, { Schema } from "mongoose";

/**
 * Base schema fields for all models
 * Provides common fields for tracking and soft deletion
 */
export const baseSchema = {
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false, index: true },
  version: { type: Number, default: 1 },
};

/**
 * Common schema options for all models
 * Standardizes JSON output and virtual field handling
 */
export const baseOptions = {
  timestamps: true,
  suppressReservedKeysWarning: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.__v;
      delete ret.isDeleted;
      return ret;
    },
  },
  toObject: { virtuals: true },
};

/**
 * Metadata schema for request tracking
 * Captures client information for analytics and security
 */
export const metadataSchema = new Schema(
  {
    device: { type: String, maxlength: 200 },
    browser: { type: String, maxlength: 100 },
    ip: { type: String, maxlength: 45 }, // IPv6 max length
    language: { type: String, maxlength: 50 },
    timezone: { type: String, maxlength: 50 },
    userAgent: { type: String, maxlength: 500 },
    platform: { type: String, maxlength: 20 },
    location: {
      country: String,
      city: String,
      region: String,
    },
  },
  { _id: false },
);

/**
 * Audit schema for change tracking
 * Maintains complete audit trail for compliance
 */
export const auditSchema = new Schema(
  {
    action: {
      type: String,
      enum: ["create", "update", "delete", "restore"],
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    timestamp: { type: Date, default: Date.now, index: true },
    changes: Schema.Types.Mixed,
    ip: { type: String, maxlength: 45 },
    userAgent: { type: String, maxlength: 500 },
    reason: { type: String, maxlength: 200 },
  },
  { _id: false },
);

/**
 * Validation helpers
 */
export const validators = {
  // Email validation
  email: {
    validator: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    message: "Invalid email format",
  },

  // URL validation
  url: {
    validator: (url) => /^https?:\/\/.+/.test(url),
    message: "Invalid URL format",
  },

  // MongoDB ObjectId validation
  objectId: {
    validator: (id) => mongoose.Types.ObjectId.isValid(id),
    message: "Invalid ObjectId format",
  },
};

/**
 * Common middleware functions
 */
export const middleware = {
  // Update timestamp on save
  updateTimestamp(next) {
    this.updatedAt = new Date();
    next();
  },

  // Soft delete implementation
  softDelete(next) {
    this.isDeleted = true;
    this.updatedAt = new Date();
    next();
  },
};
