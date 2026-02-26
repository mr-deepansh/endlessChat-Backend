// src/modules/blogs/controllers/media/media.controller.js
import { asyncHandler } from "../../../../shared/utils/AsyncHandler.js";
import { ApiError } from "../../../../shared/utils/ApiError.js";
import { ApiResponse } from "../../../../shared/utils/ApiResponse.js";
import { Media } from "../../models/index.js";
import multer from "multer";

import path from "path";
import fs from "fs";

// Sanitize file path to prevent path traversal
const sanitizeFilePath = (filePath) => {
  if (!filePath || typeof filePath !== "string") {
    throw new ApiError(400, "Invalid file path");
  }

  // Normalize path and check for traversal attempts
  const normalizedPath = path.normalize(filePath);

  if (normalizedPath.includes("..") || normalizedPath.startsWith("/") || normalizedPath.includes("\\")) {
    throw new ApiError(400, "Invalid file path - path traversal detected");
  }

  return normalizedPath;
};

// Validate filename to prevent malicious names
const validateFilename = (filename) => {
  if (!filename || typeof filename !== "string") {
    throw new ApiError(400, "Invalid filename");
  }

  // Remove any path separators and dangerous characters
  const sanitized = filename.replace(/[/\\:*?"<>|]/g, "_");

  // Prevent hidden files and system files
  if (sanitized.startsWith(".") || sanitized.toLowerCase().includes("system")) {
    throw new ApiError(400, "Invalid filename format");
  }

  return sanitized;
};

// Ensure upload directories exist
const uploadDir = "uploads";
const imageDir = "uploads/images";
const videoDir = "uploads/videos";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(imageDir)) {
  fs.mkdirSync(imageDir, { recursive: true });
}
if (!fs.existsSync(videoDir)) {
  fs.mkdirSync(videoDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isImage = file.mimetype.startsWith("image/");
    const isVideo = file.mimetype.startsWith("video/");

    if (isImage) {
      cb(null, imageDir);
    } else if (isVideo) {
      cb(null, videoDir);
    } else {
      cb(null, uploadDir);
    }
  },
  filename: (req, file, cb) => {
    try {
      const sanitizedOriginalName = validateFilename(file.originalname);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(sanitizedOriginalName);
      const filename = `${file.fieldname}-${uniqueSuffix}${ext}`;
      cb(null, filename);
    } catch (error) {
      cb(error, null);
    }
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/mov",
      "video/avi",
      "video/quicktime",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, `Invalid file type: ${file.mimetype}`), false);
    }
  },
});

// Upload media
export const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "No files uploaded");
  }

  const mediaFiles = req.files.map((file) => {
    const isImage = file.mimetype.startsWith("image/");
    const isVideo = file.mimetype.startsWith("video/");
    const folder = isImage ? "images" : isVideo ? "videos" : "";

    // Sanitize file information
    const sanitizedOriginalName = validateFilename(file.originalname);
    const sanitizedFilename = validateFilename(file.filename);

    return {
      type: isImage ? "image" : isVideo ? "video" : "document",
      originalName: sanitizedOriginalName,
      filename: sanitizedFilename,
      url: `/uploads/${folder}/${sanitizedFilename}`,
      size: file.size,
      mimeType: file.mimetype,
      uploadedBy: req.user._id,
    };
  });

  const savedMedia = await Media.insertMany(mediaFiles);

  res.status(201).json(new ApiResponse(201, savedMedia, "Media uploaded successfully"));
});

// Get media
export const getMedia = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type } = req.query;
  const query = { uploadedBy: req.user._id };

  if (type) {
    query.type = type;
  }

  const media = await Media.find(query)
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Media.countDocuments(query);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        media,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
        },
      },
      "Media retrieved successfully",
    ),
  );
});

// Delete media
export const deleteMedia = asyncHandler(async (req, res) => {
  const { mediaId } = req.params;

  const media = await Media.findById(mediaId);
  if (!media) {
    throw new ApiError(404, "Media not found");
  }

  if (media.uploadedBy.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only delete your own media");
  }

  await Media.findByIdAndDelete(mediaId);

  res.status(200).json(new ApiResponse(200, {}, "Media deleted successfully"));
});
