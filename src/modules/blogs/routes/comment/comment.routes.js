// src/modules/blogs/routes/comment/comment.routes.js
import express from "express";
import { addComment, getComments, likeComment, deleteComment } from "../../controllers/comment/comment.controller.js";
import { verifyJWT } from "../../../../shared/middleware/auth.middleware.js";
import { optionalAuth } from "../../../../shared/middleware/optionalAuth.middleware.js";

const router = express.Router();

// Comment routes
router.get("/:postId", optionalAuth, getComments);
router.post("/:postId", verifyJWT, addComment);
router.post("/like/:commentId", verifyJWT, likeComment);
router.delete("/:commentId", verifyJWT, deleteComment);

export default router;
