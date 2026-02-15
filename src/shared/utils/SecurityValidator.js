// src/shared/utils/SecurityValidator.js
import { z } from "zod";

export class SecurityValidator {
  static RESERVED_USERNAMES = ["admin", "root", "system", "api", "www", "mail", "support", "help"];

  static MALICIOUS_PATTERNS = [
    /<script/i,
    /<\/script>/i,
    /javascript:/i,
    /onclick=/i,
    /(union|select|insert|update|delete)/i,
    /\.\.\//g,
    /\|\||&&|;/,
  ];

  static validateUsername(username) {
    const result = { isValid: false, errors: [], sanitized: null };

    if (!username || typeof username !== "string") {
      result.errors.push("Username is required");
      return result;
    }

    const trimmed = username.trim();

    if (trimmed.length < 3) {
      result.errors.push("Username too short");
    }
    if (trimmed.length > 30) {
      result.errors.push("Username too long");
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
      result.errors.push("Invalid characters in username");
    }
    if (this.RESERVED_USERNAMES.includes(trimmed.toLowerCase())) {
      result.errors.push("Username is reserved");
    }

    result.isValid = result.errors.length === 0;
    result.sanitized = result.isValid ? trimmed.toLowerCase() : null;
    return result;
  }

  static validatePassword(password) {
    const result = { isValid: false, errors: [], strength: "weak" };

    if (!password) {
      result.errors.push("Password is required");
      return result;
    }

    if (password.length < 8) {
      result.errors.push("Password too short");
    }
    if (!/[a-z]/.test(password)) {
      result.errors.push("Need lowercase letter");
    }
    if (!/[A-Z]/.test(password)) {
      result.errors.push("Need uppercase letter");
    }
    if (!/\d/.test(password)) {
      result.errors.push("Need number");
    }
    if (!/[@$!%*?&]/.test(password)) {
      result.errors.push("Need special character");
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  static sanitizeInput(input) {
    if (!input || typeof input !== "string") {
      return "";
    }
    return input
      .trim()
      .replace(/[<>\"'&]/g, "")
      .substring(0, 1000);
  }
}

export const secureValidationSchemas = {
  username: z.string().refine((val) => {
    const validation = SecurityValidator.validateUsername(val);
    return validation.isValid;
  }),
  password: z.string().refine((val) => {
    const validation = SecurityValidator.validatePassword(val);
    return validation.isValid;
  }),
};

export default SecurityValidator;
