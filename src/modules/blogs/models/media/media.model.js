// src/modules/blogs/models/media/media.model.js
import mongoose, { Schema } from "mongoose";
import { baseSchema, baseOptions, metadataSchema } from "../shared/base.model.js";

// Media processing status
const processingSchema = new Schema(
  {
    status: { type: String, enum: ["pending", "processing", "completed", "failed"], default: "pending" },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    error: String,
    startedAt: Date,
    completedAt: Date,
  },
  { _id: false },
);

// Media schema
const mediaSchema = new Schema(
  {
    ...baseSchema,
    type: { type: String, enum: ["image", "video", "audio", "document"], required: true, index: true },
    originalName: { type: String, required: true },
    filename: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    thumbnail: String,
    alt: String,
    caption: String,
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    dimensions: {
      width: Number,
      height: Number,
    },
    duration: Number, // for videos/audio
    quality: String,
    format: String,
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    processing: processingSchema,
    metadata: metadataSchema,
    tags: [String],
    isPublic: { type: Boolean, default: true },
    downloadCount: { type: Number, default: 0 },
    lastAccessed: Date,
  },
  baseOptions,
);

// Indexes
mediaSchema.index({ uploadedBy: 1, createdAt: -1 });
mediaSchema.index({ type: 1, isPublic: 1 });
mediaSchema.index({ size: 1 });
mediaSchema.index({ tags: 1 });

// Virtuals
mediaSchema.virtual("sizeFormatted").get(function () {
  const bytes = this.size;
  if (bytes === 0) {
    return "0 Bytes";
  }
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
});

export const Media = mongoose.model("Media", mediaSchema);
