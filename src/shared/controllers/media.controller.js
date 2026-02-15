import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../services/cloudinary.service.js";
import fs from "fs/promises";
import path from "path";

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

// Validate public ID for Cloudinary
const validatePublicId = (publicId) => {
  if (!publicId || typeof publicId !== "string") {
    throw new ApiError(400, "Invalid public ID");
  }

  // Allow only alphanumeric, hyphens, underscores, and forward slashes
  const validPattern = /^[a-zA-Z0-9_\-\/]+$/;
  if (!validPattern.test(publicId)) {
    throw new ApiError(400, "Invalid public ID format");
  }

  return publicId;
};

// Universal media upload
export const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Media file is required");
  }

  try {
    const { folder = "media" } = req.body;

    // Sanitize file path
    const sanitizedPath = sanitizeFilePath(req.file.path);

    // Upload to Cloudinary
    const result = await uploadToCloudinary(sanitizedPath, folder);

    // Delete temp file
    await fs.unlink(sanitizedPath).catch(() => {});

    res.status(200).json(new ApiResponse(200, result, "Media uploaded successfully"));
  } catch (error) {
    // Delete temp file on error
    const sanitizedPath = sanitizeFilePath(req.file.path);
    await fs.unlink(sanitizedPath).catch(() => {});
    throw error;
  }
});

// Multiple media upload
export const uploadMultipleMedia = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "Media files are required");
  }

  try {
    const { folder = "media" } = req.body;
    const uploadPromises = req.files.map((file) => {
      const sanitizedPath = sanitizeFilePath(file.path);
      return uploadToCloudinary(sanitizedPath, folder);
    });

    const results = await Promise.all(uploadPromises);

    // Delete temp files
    await Promise.all(
      req.files.map((file) => {
        const sanitizedPath = sanitizeFilePath(file.path);
        return fs.unlink(sanitizedPath).catch(() => {});
      }),
    );

    res.status(200).json(new ApiResponse(200, results, "Media files uploaded successfully"));
  } catch (error) {
    // Delete temp files on error
    await Promise.all(
      req.files.map((file) => {
        const sanitizedPath = sanitizeFilePath(file.path);
        return fs.unlink(sanitizedPath).catch(() => {});
      }),
    );
    throw error;
  }
});

// Delete media
export const deleteMedia = asyncHandler(async (req, res) => {
  const { publicId } = req.params;

  // Validate and sanitize public ID
  const sanitizedPublicId = validatePublicId(publicId);

  try {
    await deleteFromCloudinary(sanitizedPublicId);
    res.status(200).json(new ApiResponse(200, {}, "Media deleted successfully"));
  } catch (error) {
    throw new ApiError(500, "Failed to delete media");
  }
});
