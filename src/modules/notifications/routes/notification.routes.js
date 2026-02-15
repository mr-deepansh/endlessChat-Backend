import express from "express";
import { NotificationController } from "../controllers/notification.controller.js";
import { verifyJWT } from "../../../shared/middleware/auth.middleware.js";
import { validateRequest } from "../../../shared/middleware/validation.middleware.js";
import { body, param, query } from "express-validator";

const router = express.Router();
const notificationController = new NotificationController();

// Validation rules
const createSystemNotificationValidation = [
  body("recipients").isArray({ min: 1 }).withMessage("Recipients must be a non-empty array"),
  body("title")
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Title must be between 1 and 100 characters"),
  body("message")
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Message must be between 1 and 500 characters"),
  body("data").optional().isObject().withMessage("Data must be an object"),
];

const notificationIdValidation = [
  param("notificationId")
    .isLength({ min: 1 })
    .withMessage("Notification ID is required")
    .custom((value) => {
      if (value.length === 24 && /^[0-9a-fA-F]{24}$/.test(value)) {
        return true;
      }
      throw new Error("Invalid notification ID format");
    }),
];

const queryValidation = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
  query("type")
    .optional()
    .isIn([
      "like",
      "comment",
      "follow",
      "unfollow",
      "mention",
      "post",
      "repost",
      "quote",
      "reply",
      "tag",
      "story_mention",
      "friend_request",
      "friend_accept",
      "birthday",
      "anniversary",
      "system",
      "admin",
      "security",
      "welcome",
      "achievement",
    ])
    .withMessage("Invalid notification type"),
  query("isRead").optional().isBoolean().withMessage("isRead must be a boolean"),
  query("priority").optional().isIn(["low", "medium", "high", "urgent"]).withMessage("Invalid priority level"),
];

// Routes
router.get(
  "/",
  verifyJWT,
  queryValidation,
  validateRequest,
  notificationController.getNotifications.bind(notificationController),
);

router.get("/unread-count", verifyJWT, notificationController.getUnreadCount.bind(notificationController));

router.patch(
  "/:notificationId/read",
  verifyJWT,
  notificationIdValidation,
  validateRequest,
  notificationController.markAsRead.bind(notificationController),
);

router.patch("/mark-all-read", verifyJWT, notificationController.markAllAsRead.bind(notificationController));

router.delete(
  "/:notificationId",
  verifyJWT,
  notificationIdValidation,
  validateRequest,
  notificationController.deleteNotification.bind(notificationController),
);

// Statistics and preferences routes
router.get("/stats", verifyJWT, notificationController.getNotificationStats.bind(notificationController));

router.delete("/clear-all", verifyJWT, notificationController.clearAllNotifications.bind(notificationController));

router.get("/preferences", verifyJWT, notificationController.getNotificationPreferences.bind(notificationController));

router.put(
  "/preferences",
  verifyJWT,
  notificationController.updateNotificationPreferences.bind(notificationController),
);

// Admin routes
router.post(
  "/system",
  verifyJWT,
  // Add admin role check middleware here if available
  createSystemNotificationValidation,
  validateRequest,
  notificationController.createSystemNotification.bind(notificationController),
);

export default router;
