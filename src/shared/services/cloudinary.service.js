import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

// Validate environment variables
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error("❌ Missing Cloudinary credentials:", {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? "SET" : "MISSING",
    api_key: process.env.CLOUDINARY_API_KEY ? "SET" : "MISSING",
    api_secret: process.env.CLOUDINARY_API_SECRET ? "SET" : "MISSING",
  });
  throw new Error("Cloudinary credentials are not properly configured");
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = async (filePath, folder = "posts", resourceType = "auto") => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      quality: "auto",
      resource_type: resourceType,
      use_filename: false,
      unique_filename: true,
      eager: [
        { width: 800, height: 600, crop: "limit", quality: "auto:good" },
        { width: 400, height: 300, crop: "limit", quality: "auto:low" },
      ],
      eager_async: true,
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error("❌ Upload failed:", error.message);
    throw new Error(`Upload failed: ${error.message}`);
  }
};

export const deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Delete failed:", error);
  }
};
