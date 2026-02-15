// src/shared/validators/search.validator.js
import { z } from "zod";

// Custom validation functions
const sanitizeSearchTerm = (term) => {
  // Remove potentially dangerous characters
  return term.replace(/[<>{}();'"\\]/g, "").trim();
};

const validateSearchTerm = (term) => {
  // Check for common XSS patterns
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
  ];

  return !xssPatterns.some((pattern) => pattern.test(term));
};

export const searchValidation = {
  // Basic user search validation
  searchUsers: z
    .object({
      search: z
        .string()
        .min(1, "Search term is required")
        .max(100, "Search term cannot exceed 100 characters")
        .transform(sanitizeSearchTerm)
        .refine((val) => val.length >= 2, "Search term must be at least 2 characters after sanitization")
        .refine(validateSearchTerm, "Search term contains invalid characters"),
      page: z
        .string()
        .optional()
        .default("1")
        .transform((val) => parseInt(val, 10))
        .refine((val) => val > 0 && val <= 1000, "Page must be between 1 and 1000"),
      limit: z
        .string()
        .optional()
        .default("10")
        .transform((val) => parseInt(val, 10))
        .refine((val) => val > 0 && val <= 50, "Limit must be between 1 and 50"),
      sortBy: z.enum(["relevance", "username", "followers", "newest", "verified"]).default("relevance"),
      includePrivate: z
        .string()
        .optional()
        .default("false")
        .transform((val) => val === "true"),
      includeInactive: z
        .string()
        .optional()
        .default("false")
        .transform((val) => val === "true"),
    })
    .strict(),

  // Advanced search with multiple filters
  advancedSearch: z
    .object({
      search: z
        .string()
        .min(1, "Search term is required")
        .max(100, "Search term cannot exceed 100 characters")
        .transform(sanitizeSearchTerm)
        .refine(validateSearchTerm, "Invalid search term"),
      username: z
        .string()
        .min(1)
        .max(30)
        .regex(/^[a-zA-Z0-9_]+$/, "Invalid username format")
        .optional(),
      firstName: z
        .string()
        .min(1)
        .max(50)
        .regex(/^[a-zA-Z\s]+$/, "Invalid first name format")
        .optional(),
      lastName: z
        .string()
        .min(1)
        .max(50)
        .regex(/^[a-zA-Z\s]+$/, "Invalid last name format")
        .optional(),
      email: z.string().email("Invalid email format").optional(),
      role: z.enum(["user", "admin", "moderator"]).optional(),
      isVerified: z
        .string()
        .optional()
        .transform((val) => val === "true"),
      isActive: z
        .string()
        .optional()
        .transform((val) => val === "true"),
      isPrivate: z
        .string()
        .optional()
        .transform((val) => val === "true"),
      minFollowers: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : undefined))
        .refine((val) => !val || (val >= 0 && val <= 1000000), "Invalid follower count"),
      maxFollowers: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : undefined))
        .refine((val) => !val || (val >= 0 && val <= 1000000), "Invalid follower count"),
      createdAfter: z
        .string()
        .optional()
        .refine((val) => !val || !isNaN(Date.parse(val)), "Invalid date format"),
      createdBefore: z
        .string()
        .optional()
        .refine((val) => !val || !isNaN(Date.parse(val)), "Invalid date format"),
      page: z
        .string()
        .optional()
        .default("1")
        .transform((val) => parseInt(val, 10))
        .refine((val) => val > 0 && val <= 1000, "Invalid page number"),
      limit: z
        .string()
        .optional()
        .default("10")
        .transform((val) => parseInt(val, 10))
        .refine((val) => val > 0 && val <= 50, "Invalid limit"),
      sortBy: z.enum(["relevance", "username", "followers", "newest", "verified", "alphabetical"]).default("relevance"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    })
    .strict()
    .refine((data) => !data.minFollowers || !data.maxFollowers || data.minFollowers <= data.maxFollowers, {
      message: "Minimum followers cannot be greater than maximum followers",
      path: ["minFollowers"],
    })
    .refine(
      (data) =>
        !data.createdAfter || !data.createdBefore || new Date(data.createdAfter) <= new Date(data.createdBefore),
      {
        message: "Created after date cannot be later than created before date",
        path: ["createdAfter"],
      },
    ),

  // Search suggestions for autocomplete
  searchSuggestions: z
    .object({
      q: z
        .string()
        .min(1, "Query is required")
        .max(50, "Query cannot exceed 50 characters")
        .transform(sanitizeSearchTerm)
        .refine(validateSearchTerm, "Invalid query"),
      type: z.enum(["users", "usernames", "names", "all"]).default("all"),
      limit: z
        .string()
        .optional()
        .default("5")
        .transform((val) => parseInt(val, 10))
        .refine((val) => val > 0 && val <= 20, "Limit must be between 1 and 20"),
    })
    .strict(),

  // Profile query validation
  profileQuery: z
    .object({
      includeStats: z
        .string()
        .optional()
        .default("true")
        .transform((val) => val === "true"),
      includePosts: z
        .string()
        .optional()
        .default("false")
        .transform((val) => val === "true"),
      includeFollowers: z
        .string()
        .optional()
        .default("false")
        .transform((val) => val === "true"),
      includeFollowing: z
        .string()
        .optional()
        .default("false")
        .transform((val) => val === "true"),
      postsLimit: z
        .string()
        .optional()
        .default("10")
        .transform((val) => parseInt(val, 10))
        .refine((val) => val > 0 && val <= 50, "Posts limit must be between 1 and 50"),
    })
    .strict(),

  // Search analytics validation (admin only)
  searchAnalytics: z
    .object({
      startDate: z.string().refine((val) => !isNaN(Date.parse(val)), "Invalid start date"),
      endDate: z.string().refine((val) => !isNaN(Date.parse(val)), "Invalid end date"),
      groupBy: z.enum(["day", "week", "month"]).default("day"),
      includeTerms: z
        .string()
        .optional()
        .default("true")
        .transform((val) => val === "true"),
      limit: z
        .string()
        .optional()
        .default("100")
        .transform((val) => parseInt(val, 10))
        .refine((val) => val > 0 && val <= 1000, "Invalid limit"),
    })
    .strict()
    .refine((data) => new Date(data.startDate) <= new Date(data.endDate), {
      message: "Start date cannot be later than end date",
      path: ["startDate"],
    }),

  // Search filters validation
  searchFilters: z
    .object({
      verified: z.boolean().optional(),
      active: z.boolean().optional(),
      private: z.boolean().optional(),
      hasAvatar: z.boolean().optional(),
      hasBio: z.boolean().optional(),
      minAge: z.number().int().min(13).max(120).optional(),
      maxAge: z.number().int().min(13).max(120).optional(),
      location: z.string().max(100).optional(),
      interests: z.array(z.string().max(50)).max(10).optional(),
      languages: z.array(z.string().length(2)).max(5).optional(),
    })
    .strict()
    .refine((data) => !data.minAge || !data.maxAge || data.minAge <= data.maxAge, {
      message: "Minimum age cannot be greater than maximum age",
      path: ["minAge"],
    }),

  // Bulk search validation
  bulkSearch: z
    .object({
      queries: z
        .array(z.string().min(1).max(100).transform(sanitizeSearchTerm))
        .min(1, "At least one search query is required")
        .max(10, "Cannot search for more than 10 terms at once"),
      limit: z.number().int().min(1).max(50).default(10),
      includeStats: z.boolean().default(false),
    })
    .strict(),
};

// Export search term sanitization for use in controllers
export { sanitizeSearchTerm, validateSearchTerm };
