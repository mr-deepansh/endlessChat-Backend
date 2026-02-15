// src/modules/users/validators/user.validator.js
import { z } from "zod";

const usernamePattern = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9._]+$/, "Username can only contain letters, numbers, dots, and underscores");

const emailPattern = z.string().email("Invalid email format");

const passwordPattern = z
  .string()
  .min(8)
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    "Password must contain at least one uppercase letter, one lowercase letter, " +
      "one number, and one special character",
  );

export const registerUserSchema = z
  .object({
    username: usernamePattern,
    email: emailPattern,
    password: passwordPattern,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const loginUserSchema = z.object({
  email: emailPattern,
  password: z.string().min(1, "Password is required"),
});

export const updateUserSchema = z.object({
  username: usernamePattern.optional(),
  email: emailPattern.optional(),
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(100).optional(),
  website: z.string().url().optional().or(z.literal("")),
  profileImage: z.string().url().optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/)
    .optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordPattern,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: emailPattern,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Reset token is required"),
    newPassword: passwordPattern,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
