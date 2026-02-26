// src/modules/blogs/routes/media/media.routes.js
import express from "express";
import { uploadMedia, getMedia, deleteMedia, upload } from "../../controllers/media/media.controller.js";
import { verifyJWT } from "../../../../shared/middleware/auth.middleware.js";

const router = express.Router();

// All routes require authentication
router.use(verifyJWT);

// Media routes
router.post("/upload", upload.array("files", 5), uploadMedia);
router.get("/", getMedia);
router.delete("/:mediaId", deleteMedia);

export default router;
