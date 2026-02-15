// src/shared/validators/zod.validator.js
import { z } from "zod";

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

export const zodValidation = {
  // Register/Create user
  createUser: z
    .object({
      username: z
        .string()
        .trim()
        .min(3, "Username must be at least 3 characters")
        .max(30, "Username cannot exceed 30 characters")
        .regex(/^[a-zA-Z0-9._]+$/, "Username can only contain letters, numbers, dots, underscores")
        .refine(
          (username) => {
            // Security validations
            const securityChecks = [
              // Cannot start or end with special characters
              !/^[._]/.test(username) && !/[._]$/.test(username),
              // Cannot have consecutive special characters
              !/[._]{2,}/.test(username),
              // Must contain at least one letter or number
              /[a-zA-Z0-9]/.test(username),
              // Cannot be all numbers (prevents confusion with IDs)
              !/^\d+$/.test(username),
              // Prevent reserved words and system usernames
              ![
                "admin",
                "root",
                "api",
                "www",
                "ftp",
                "mail",
                "test",
                "guest",
                "anonymous",
                "null",
                "undefined",
                "system",
                "support",
                "help",
                "info",
                "contact",
                "about",
                "terms",
                "privacy",
                "security",
                "login",
                "register",
                "signup",
                "signin",
                "logout",
                "profile",
                "settings",
                "config",
                "dashboard",
                "moderator",
              ].includes(username.toLowerCase()),
              // Prevent potential XSS patterns
              !/[<>"'&%]/.test(username),
              // Prevent SQL injection patterns (basic)
              !/(union|select|insert|update|delete|drop|create|alter|exec|script)/i.test(username),
            ];
            return securityChecks.every((check) => check);
          },
          {
            message: "Username format is invalid or contains restricted content",
          },
        )
        .transform((username) => username.toLowerCase()),
      email: z.string().email("Enter a valid email").trim().toLowerCase(),
      password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .regex(passwordRegex, "Password must contain uppercase, lowercase, number, and special character"),
      confirmPassword: z.string(),
      firstName: z.string().min(2).max(50).trim(),
      lastName: z.string().min(2).max(50).trim(),
      bio: z.string().max(500).optional(),
      avatar: z.string().url("Avatar must be a valid URL").optional(),
      role: z.enum(["user", "admin", "moderator"]).optional(),
    })
    .strict()
    .refine((data) => data.password === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"],
    })
    .refine((data) => data.username !== data.password, {
      message: "Username and password cannot be the same",
      path: ["password"],
    }),

  // Fixed Login - allows both username and email
  loginUser: z
    .object({
      username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(30, "Username cannot exceed 30 characters")
        .trim()
        .optional(),
      email: z.string().email("Enter a valid email address").trim().toLowerCase().optional(),
      password: z.string().min(1, "Password is required"),
    })
    .strict()
    .refine((data) => data.username || data.email, {
      message: "Either username or email is required",
      path: ["username"], // This will show error on username field
    }),

  // Alternative login schemas for different use cases
  loginWithEmail: z
    .object({
      email: z.string().email("Enter a valid email").trim().toLowerCase(),
      password: z.string().min(1, "Password is required"),
    })
    .strict(),

  loginWithUsername: z
    .object({
      username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(30, "Username cannot exceed 30 characters")
        .trim(),
      password: z.string().min(1, "Password is required"),
    })
    .strict(),

  // More flexible login that accepts identifier field
  loginFlexible: z
    .object({
      identifier: z.string().min(1, "Username or email is required").trim().optional(),
      username: z.string().min(1).trim().optional(),
      email: z.string().email().trim().toLowerCase().optional(),
      password: z.string().min(1, "Password is required"),
      rememberMe: z.boolean().optional().default(false),
    })
    .strict()
    .refine((data) => data.identifier || data.username || data.email, {
      message: "Username, email, or identifier is required",
      path: ["identifier"],
    }),

  // Update user
  updateUser: z
    .object({
      username: z
        .string()
        .trim()
        .min(3)
        .max(30)
        .regex(/^[a-zA-Z0-9._]+$/, "Username can only contain letters, numbers, dots, and underscores")
        .refine((username) => {
          if (!username) {
            return true;
          } // Skip validation if optional and empty
          const securityChecks = [
            !/^[._]/.test(username) && !/[._]$/.test(username),
            !/[._]{2,}/.test(username),
            /[a-zA-Z0-9]/.test(username),
            !/^\d+$/.test(username),
          ];
          return securityChecks.every((check) => check);
        }, "Invalid username format")
        .transform((username) => (username ? username.toLowerCase() : username))
        .optional(),
      email: z.string().email().trim().toLowerCase().optional(),
      firstName: z.string().min(2).max(50).trim().optional(),
      lastName: z.string().min(2).max(50).trim().optional(),
      bio: z.string().max(500).optional(),
      avatar: z.string().url().optional(),
      isActive: z.boolean().optional(),
      role: z
        .enum(["user", "admin", "moderator"], {
          errorMap: () => ({
            message: "Role must be one of: user, admin, moderator",
          }),
        })
        .optional(),
    })
    .strict(),

  // Search users
  searchUser: z
    .object({
      search: z.string().min(2, "Search query must be at least 2 characters").optional(),
      username: z.string().min(2, "Username must be at least 2 characters").optional(),
      firstName: z.string().min(2, "First name must be at least 2 characters").optional(),
      lastName: z.string().min(2, "Last name must be at least 2 characters").optional(),
      page: z.string().regex(/^\d+$/, "Page must be a number").transform(Number).optional(),
      limit: z.string().regex(/^\d+$/, "Limit must be a number").transform(Number).optional(),
      sortBy: z.enum(["relevance", "followers", "newest", "username"]).optional(),
      includePrivate: z
        .string()
        .transform((val) => val === "true")
        .optional(),
    })
    .refine((data) => data.search || data.username || data.firstName || data.lastName, {
      message: "At least one search parameter is required",
      path: ["search"],
    }),

  // Update own profile
  updateProfile: z
    .object({
      username: z
        .string()
        .trim()
        .min(3)
        .max(30)
        .regex(/^[a-zA-Z0-9._]+$/, "Username can only contain letters, numbers, dots, and underscores")
        .refine((username) => {
          if (!username) {
            return true;
          } // Skip validation if optional and empty
          const securityChecks = [
            !/^[._]/.test(username) && !/[._]$/.test(username),
            !/[._]{2,}/.test(username),
            /[a-zA-Z0-9]/.test(username),
            !/^\d+$/.test(username),
          ];
          return securityChecks.every((check) => check);
        }, "Invalid username format")
        .transform((username) => (username ? username.toLowerCase() : username))
        .optional(),
      firstName: z.string().min(2).max(50).trim().optional(),
      lastName: z.string().min(2).max(50).trim().optional(),
      bio: z.string().max(500).optional(),
      location: z.string().max(100).optional(),
      website: z.string().url().optional().or(z.literal("")),
      avatar: z.string().url().optional(),
    })
    .strict(),

  // Change password
  changePassword: z
    .object({
      currentPassword: z.string().min(1, "Current password is required"),
      newPassword: z
        .string()
        .min(8)
        .regex(passwordRegex, "New password must contain uppercase, lowercase, number, and special character"),
      confirmNewPassword: z.string(),
    })
    .strict()
    .refine((data) => data.newPassword === data.confirmNewPassword, {
      message: "New passwords don't match",
      path: ["confirmNewPassword"],
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: "New password must be different from current password",
      path: ["newPassword"],
    }),

  // User ID param
  userId: z
    .object({
      id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a valid MongoDB ObjectId"),
    })
    .strict(),

  // Get users with filters
  getUsers: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      search: z.string().min(2).max(50).optional(),
      role: z.enum(["user", "admin", "moderator"]).optional(),
      isActive: z.coerce.boolean().optional(),
      isVerified: z.coerce.boolean().optional(),
      sortBy: z.enum(["username", "email", "firstName", "lastName", "createdAt", "updatedAt"]).default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    })
    .strict(),

  getFollowers: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .strict(),

  getFollowing: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .strict(),

  getFeed: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      sort: z.enum(["recent", "popular", "trending"]).optional().default("recent"),
    })
    .strict(),
};

// Usage examples and middleware function
export const validateLogin = (req, res, next) => {
  try {
    // Validate the request body
    const validatedData = zodValidation.loginUser.parse(req.body);

    // Attach validated data to request
    req.validatedBody = validatedData;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Alternative validation for flexible login
export const validateFlexibleLogin = (req, res, next) => {
  try {
    const validatedData = zodValidation.loginFlexible.parse(req.body);
    req.validatedBody = validatedData;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
