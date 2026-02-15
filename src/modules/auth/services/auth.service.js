import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User } from "../../users/models/user.model.js";
import { ApiError } from "../../../shared/utils/ApiError.js";
import { redisClient, RedisUtils } from "../../../config/redis/redis.config.js";
import { emailService } from "../../email/services/email.service.js";
import { Logger } from "../../../shared/utils/Logger.js";

const logger = new Logger("AuthService");

// Cache user data in Redis to reduce DB queries
const setCachedUser = async (userId, userData, ttl = 300) => {
  try {
    await redisClient.setex(`user:${userId}`, ttl, JSON.stringify(userData));
  } catch (error) {
    console.error("Redis user cache set failed:", error);
  }
};

class AuthService {
  // 🚀 HIGH-PERFORMANCE REGISTRATION
  static async registerUser(userData, req) {
    const { username, email, password, firstName, lastName, bio, avatar } = userData;
    // Batch existence check with single query
    const existingUsers = await User.find({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
    })
      .select("email username")
      .lean();
    // Check conflicts
    const emailExists = existingUsers.find((u) => u.email === email.toLowerCase());
    const usernameExists = existingUsers.find((u) => u.username === username.toLowerCase());
    if (emailExists || usernameExists) {
      const conflicts = [];
      if (emailExists) {
        conflicts.push("email");
      }
      if (usernameExists) {
        conflicts.push("username");
      }
      throw new ApiError(409, "Registration failed", {
        conflicts,
        message: `${conflicts.join(" and ")} already in use`,
      });
    }
    // Create user with optimized data structure
    // Password will be hashed by the User model's pre-save middleware
    const user = await User.create({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password, // Let the model handle hashing
      firstName,
      lastName,
      bio: bio?.substring(0, 500) || "", // Limit bio length
      avatar,
      isActive: true,
      role: "user", // Always default to user
      // Initialize arrays to prevent null issues
      followers: [],
      following: [],
      watchHistory: [],
    });
    // Send welcome email (non-blocking)
    setImmediate(async () => {
      try {
        const registeredAt = new Date().toLocaleString("en-US", {
          timeZone: "UTC",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        });
        await emailService.sendEmail({
          to: user.email,
          subject: "🎉 Welcome to endlessChatt!",
          template: "welcome-registration",
          context: {
            firstName: user.firstName,
            username: user.username,
            email: user.email,
            registeredAt,
            loginUrl: process.env.FRONTEND_URL,
          },
        });
      } catch (emailError) {
        console.warn("Welcome email failed:", emailError.message);
      }
    });
    // Log activity asynchronously
    this.logActivity(user, "register", req).catch(console.error);
    return user;
  }

  // 🔥 OPTIMIZED LOGIN WITH SECURITY
  static async loginUser({ identifier, password }, req) {
    const startTime = Date.now();
    // Find user with single query
    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }],
      isActive: true,
    }).select("+password +security.failedLoginAttempts +security.lockUntil");
    if (!user) {
      // Consistent timing to prevent user enumeration
      await bcrypt.hash("dummy", 10);
      throw new ApiError(401, "Invalid credentials");
    }
    // Check account lockout
    if (user.isAccountLocked()) {
      throw new ApiError(423, "Account temporarily locked due to failed attempts");
    }
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      // Increment failed attempts
      await user.incrementFailedLoginAttempts();
      throw new ApiError(401, "Invalid credentials");
    }
    // Reset failed attempts on successful login
    if (user.security.failedLoginAttempts > 0) {
      await user.resetFailedLoginAttempts();
    }
    // Generate tokens
    const { accessToken, refreshToken } = this.generateTokens(user._id);
    // Update user data
    await User.findByIdAndUpdate(user._id, {
      refreshToken,
      lastActive: new Date(),
      "security.lastLoginIP": req.ip,
      "security.lastLoginLocation": req.get("CF-IPCountry") || "Unknown",
    });
    // Cache user data
    const userForCache = await User.findById(user._id).select("-password -refreshToken").lean();
    await setCachedUser(user._id, userForCache);
    // Send login notification email (non-blocking)
    setImmediate(async () => {
      try {
        const userAgent = req.get ? req.get("User-Agent") : req.headers?.["user-agent"] || "Unknown";
        const ip = req.ip || req.connection?.remoteAddress || "Unknown";
        const getDeviceInfo = (ua) => {
          const sanitizedUA = String(ua || "").replace(/[<>"'&]/g, "");
          const os = sanitizedUA.includes("Windows")
            ? "Windows"
            : sanitizedUA.includes("Mac")
              ? "macOS"
              : sanitizedUA.includes("Linux")
                ? "Linux"
                : sanitizedUA.includes("Android")
                  ? "Android"
                  : sanitizedUA.includes("iOS")
                    ? "iOS"
                    : "Unknown";
          const platform = sanitizedUA.includes("Mobile")
            ? "Mobile"
            : sanitizedUA.includes("Tablet")
              ? "Tablet"
              : "Desktop";
          return { os, platform };
        };
        const deviceInfo = getDeviceInfo(userAgent);
        const loginTime = new Date().toLocaleString("en-US", {
          timeZone: "UTC",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        });
        await emailService.sendEmail({
          to: user.email,
          subject: "🔐 New Login Detected - endlessChatt",
          template: "login-notification-new",
          context: {
            firstName: user.firstName,
            username: user.username,
            ip,
            platform: deviceInfo.platform,
            os: deviceInfo.os,
            location: req.get("CF-IPCountry") || "Unknown",
            loginTime,
          },
        });
      } catch (emailError) {
        console.warn("Login notification email failed:", emailError.message);
      }
    });
    // Log activity asynchronously
    this.logActivity(user, "login", req).catch(console.error);
    const executionTime = Date.now() - startTime;
    console.log(`✅ Login completed in ${executionTime}ms`);
    return {
      user: userForCache,
      accessToken,
      refreshToken,
    };
  }

  // 🔥 OPTIMIZED LOGOUT WITH TOKEN BLACKLISTING
  static async logoutUser(user, token, req) {
    const startTime = Date.now();
    try {
      // Parallel operations for better performance
      await Promise.all([
        // Clear refresh token in DB
        User.findByIdAndUpdate(user._id, {
          $unset: { refreshToken: 1 },
          lastActive: new Date(),
        }),
        // Add token to blacklist (expires with token)
        this.blacklistToken(token),
        // Clear user cache
        redisClient.del(`user:${user._id}`).catch(console.error),
      ]);
      // Log activity asynchronously
      this.logActivity(user, "logout", req).catch(console.error);
      const executionTime = Date.now() - startTime;
      console.log(`✅ Logout completed in ${executionTime}ms`);
      return true;
    } catch (error) {
      console.error("Logout error:", error);
      throw new ApiError(500, "Logout failed");
    }
  }

  // Token blacklisting for security
  static async blacklistToken(token) {
    try {
      const decoded = jwt.decode(token);
      const expiryTime = decoded.exp * 1000; // Convert to milliseconds
      const currentTime = Date.now();
      const ttl = Math.max(0, Math.floor((expiryTime - currentTime) / 1000));
      if (ttl > 0) {
        await redisClient.setex(`blacklist:${token}`, ttl, "1");
      }
    } catch (error) {
      console.error("Token blacklist failed:", error);
    }
  }

  // 🚀 OPTIMIZED TOKEN GENERATION
  static generateTokens(userId) {
    const accessToken = jwt.sign({ _id: userId }, process.env.ACCESS_TOKEN_SECRET, {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "15m",
      algorithm: "HS256",
    });
    const refreshToken = jwt.sign({ _id: userId, type: "refresh" }, process.env.REFRESH_TOKEN_SECRET, {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "7d",
      algorithm: "HS256",
    });
    return { accessToken, refreshToken };
  }

  // 🚀 OPTIMIZED TOKEN REFRESH
  static async refreshTokens(oldRefreshToken) {
    try {
      const decoded = jwt.verify(oldRefreshToken, process.env.REFRESH_TOKEN_SECRET);
      // Validate refresh token type
      if (decoded.type !== "refresh") {
        throw new ApiError(401, "Invalid token type");
      }
      const user = await User.findById(decoded._id).select("refreshToken isActive");
      if (!user || !user.isActive) {
        throw new ApiError(401, "User not found or inactive");
      }
      if (user.refreshToken !== oldRefreshToken) {
        // Possible token reuse - security issue
        await User.findByIdAndUpdate(user._id, { $unset: { refreshToken: 1 } });
        throw new ApiError(401, "Invalid refresh token - please login again");
      }
      // Generate new tokens
      const { accessToken, refreshToken } = this.generateTokens(user._id);
      // Update user with new refresh token
      await User.findByIdAndUpdate(user._id, {
        refreshToken,
        lastActive: new Date(),
      });
      // Blacklist old refresh token
      await this.blacklistToken(oldRefreshToken);
      return { accessToken, refreshToken };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new ApiError(401, "Invalid refresh token");
      }
      throw error;
    }
  }

  // 🔥 ENTERPRISE FORGOT PASSWORD (Millions of Users)
  static async processForgotPassword(email, req) {
    const startTime = Date.now();
    // Optimized user lookup with minimal fields
    const user = await User.findOne(
      { email: email.toLowerCase(), isActive: true },
      { _id: 1, email: 1, firstName: 1, username: 1, forgotPasswordExpiry: 1 },
    ).lean();
    if (!user) {
      // Consistent timing to prevent user enumeration
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { message: "If the email exists, a password reset link has been sent" };
    }
    // Allow multiple reset requests but with reasonable cooldown (2 minutes)
    if (user.forgotPasswordExpiry && user.forgotPasswordExpiry > new Date()) {
      const timeLeft = Math.ceil((user.forgotPasswordExpiry - new Date()) / 1000 / 60);
      if (timeLeft > 8) {
        // Only block if more than 8 minutes left (allow resend after 2 minutes)
        return {
          message: `Password reset link already sent. Please wait ${timeLeft} minutes before requesting again.`,
        };
      }
    }
    // Generate enterprise-grade secure token with multiple layers
    const payload = {
      userId: user._id,
      email: user.email,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString("hex"),
      ip: req.ip || "127.0.0.1",
    };
    // Validate required environment variables
    const resetSecret = process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET;
    if (!resetSecret) {
      throw new ApiError(500, "Server configuration error");
    }
    // Create JWT token with encryption
    const resetToken = jwt.sign(payload, resetSecret, {
      expiresIn: "10m",
      algorithm: "HS256",
      issuer: "endlessChatt-security",
      audience: "password-reset",
    });
    // Additional encryption layer with IV
    const algorithm = "aes-256-cbc";
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!encryptionKey) {
      throw new ApiError(500, "Server configuration error");
    }
    const key = crypto.scryptSync(encryptionKey, "salt", 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encryptedToken = cipher.update(resetToken, "utf8", "hex");
    encryptedToken += cipher.final("hex");
    // Prepend IV to encrypted token
    encryptedToken = `${iv.toString("hex")}:${encryptedToken}`;
    const resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    // Atomic update with optimistic concurrency
    const updateResult = await User.findByIdAndUpdate(
      user._id,
      {
        forgotPasswordToken: encryptedToken,
        forgotPasswordExpiry: resetTokenExpiry,
        lastActive: new Date(),
      },
      { new: true, select: "_id" },
    );
    if (!updateResult) {
      throw new ApiError(500, "Failed to process password reset request");
    }
    // Async email sending (non-blocking)
    setImmediate(async () => {
      try {
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(encryptedToken)}`;
        await emailService.sendEmail({
          to: user.email,
          subject: "🔒 Password Reset - endlessChatt",
          template: "forgot-password",
          context: {
            firstName: user.firstName,
            username: user.username,
            resetUrl,
          },
        });
      } catch (emailError) {
        logger.error("Email send failed", { error: emailError.message, email: user.email });
        // Log to monitoring system in production
      }
    });
    // Async activity logging
    this.logActivity({ _id: user._id, email: user.email }, "forgot_password", req).catch(console.error);
    const executionTime = Date.now() - startTime;
    logger.info("Forgot password processed", { executionTime: `${executionTime}ms`, email: user.email });
    return { message: "If the email exists, a password reset link has been sent" };
  }

  // 🔥 ENTERPRISE PASSWORD RESET (High Performance)
  static async resetPassword(token, newPassword, req) {
    const startTime = Date.now();

    // Input validation
    if (!token || token.length < 32) {
      throw new ApiError(400, "Invalid reset token format");
    }
    // Check if token is blacklisted (already used) - FIRST CHECK
    const isBlacklisted = await redisClient.get(`blacklist_reset:${token}`);
    if (isBlacklisted) {
      await bcrypt.hash("dummy", 10); // Consistent timing
      throw new ApiError(400, "This reset link has already been used. Please request a new password reset.");
    }
    let user;
    try {
      // Extract IV and encrypted data
      const [ivHex, encryptedData] = token.split(":");
      if (!ivHex || !encryptedData) {
        throw new Error("Invalid token format");
      }
      // Decrypt the token
      const algorithm = "aes-256-cbc";
      const decryptionKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
      if (!decryptionKey) {
        throw new ApiError(500, "Server configuration error");
      }
      const key = crypto.scryptSync(decryptionKey, "salt", 32);
      const iv = Buffer.from(ivHex, "hex");
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decryptedToken = decipher.update(encryptedData, "hex", "utf8");
      decryptedToken += decipher.final("utf8");
      // Verify JWT token
      const verifySecret = process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET;
      if (!verifySecret) {
        throw new ApiError(500, "Server configuration error");
      }
      const payload = jwt.verify(decryptedToken, verifySecret, {
        algorithm: "HS256",
        issuer: "endlessChatt-security",
        audience: "password-reset",
      });
      // Additional security checks
      if (payload.ip !== (req.ip || "127.0.0.1")) {
        logger.warn("IP mismatch in reset token", {
          originalIP: payload.ip,
          currentIP: req.ip,
          userId: payload.userId,
        });
        // Allow but log for monitoring
      }
      // Find user with decrypted payload
      user = await User.findOne(
        {
          _id: payload.userId,
          email: payload.email,
          forgotPasswordToken: token,
          forgotPasswordExpiry: { $gt: new Date() },
          isActive: true,
        },
        { _id: 1, email: 1, firstName: 1, username: 1, password: 1 },
      );
    } catch (decryptError) {
      await bcrypt.hash("dummy", 10); // Consistent timing
      logger.error("Token decryption failed", { error: decryptError.message });
      throw new ApiError(400, "Invalid or corrupted reset token");
    }
    if (!user) {
      // Consistent timing for security
      await bcrypt.hash("dummy", 10);
      throw new ApiError(400, "Invalid or expired reset token");
    }
    // Password strength validation
    if (newPassword.length < 8) {
      throw new ApiError(400, "Password must be at least 8 characters long");
    }
    // Check if new password is same as current (optional security)
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new ApiError(400, "New password must be different from current password");
    }
    // Hash password before saving
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    // Blacklist the reset token immediately to prevent reuse
    await redisClient.setex(`blacklist_reset:${token}`, 86400, "1"); // 24 hour blacklist
    // Atomic update with security fields
    const updateResult = await User.findByIdAndUpdate(
      user._id,
      {
        password: hashedPassword,
        "security.lastPasswordChange": new Date(),
        lastActive: new Date(),
        $unset: {
          forgotPasswordToken: 1,
          forgotPasswordExpiry: 1,
          // Clear any existing sessions for security
          refreshToken: 1,
        },
        $inc: { "security.passwordResetCount": 1 },
      },
      { new: true, select: "_id" },
    );
    if (!updateResult) {
      throw new ApiError(500, "Failed to reset password");
    }
    // Invalidate ALL user sessions and tokens for complete security
    try {
      await Promise.all([
        // Clear user cache
        redisClient.del(`user:${user._id}`),
        // Clear all session patterns
        redisClient.del(`sessions:${user._id}:*`),
        // Clear any cached tokens
        redisClient.del(`tokens:${user._id}:*`),
        // Force logout by clearing refresh token patterns
        redisClient.del(`refresh:${user._id}:*`),
      ]);
      logger.info("All user sessions invalidated", { userId: user._id });
    } catch (cacheError) {
      logger.warn("Cache cleanup failed", { error: cacheError.message, userId: user._id });
    }
    // Async success email notification
    setImmediate(async () => {
      try {
        const userAgent = req.get ? req.get("User-Agent") : req.headers?.["user-agent"] || "Unknown";
        const ip = req.ip || req.connection?.remoteAddress || "Unknown";
        const getDeviceInfo = (ua) => {
          const sanitizedUA = String(ua || "").replace(/[<>"'&]/g, "");
          const os = sanitizedUA.includes("Windows")
            ? "Windows"
            : sanitizedUA.includes("Mac")
              ? "macOS"
              : sanitizedUA.includes("Linux")
                ? "Linux"
                : sanitizedUA.includes("Android")
                  ? "Android"
                  : sanitizedUA.includes("iOS")
                    ? "iOS"
                    : "Unknown";
          const platform = sanitizedUA.includes("Mobile")
            ? "Mobile"
            : sanitizedUA.includes("Tablet")
              ? "Tablet"
              : "Desktop";
          return { os, platform };
        };
        const deviceInfo = getDeviceInfo(userAgent);
        const resetTime = new Date().toLocaleString("en-US", {
          timeZone: "UTC",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        });
        await emailService.sendEmail({
          to: user.email,
          subject: "✅ Password Reset Successful - endlessChatt",
          template: "password-reset-success",
          context: {
            firstName: user.firstName,
            username: user.username,
            ip,
            platform: deviceInfo.platform,
            os: deviceInfo.os,
            resetTime,
          },
        });
      } catch (emailError) {
        logger.error("Success email failed", { error: emailError.message, email: user.email });
      }
    });
    // Async activity logging
    this.logActivity(user, "password_reset", req).catch(console.error);
    const executionTime = Date.now() - startTime;
    logger.info("Password reset completed", { executionTime: `${executionTime}ms`, userId: user._id });
    return {
      message: "Password reset successfully. Please login with your new password.",
      redirectTo: "/login",
    };
  }

  // 🔥 EMAIL VERIFICATION
  static async sendWelcomeEmail(user, verificationToken, req) {
    try {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${encodeURIComponent(verificationToken)}`;
      await emailService.sendEmail({
        to: user.email,
        subject: "🎉 Welcome to EndlessChatt - Verify Your Email",
        template: "welcome-verification",
        context: {
          firstName: user.firstName,
          username: user.username,
          verificationUrl,
        },
      });
      logger.info("Verification email sent", { email: user.email });
    } catch (emailError) {
      logger.error("Verification email failed", { error: emailError.message, email: user.email });
      throw new ApiError(500, "Failed to send verification email");
    }
  }

  // 🔥 VERIFY EMAIL TOKEN
  static async verifyEmail(token, req = {}) {
    try {
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
      const user = await User.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpiry: { $gt: new Date() },
        isActive: true,
      });
      if (!user) {
        throw new ApiError(400, "Invalid or expired verification token");
      }
      if (user.isEmailVerified) {
        return { message: "Email is already verified" };
      }
      // Update user as verified
      await User.findByIdAndUpdate(user._id, {
        isEmailVerified: true,
        $unset: {
          emailVerificationToken: 1,
          emailVerificationExpiry: 1,
        },
      });
      // Send success email with user details
      setImmediate(async () => {
        try {
          await this.sendEmailVerificationSuccess(user, req);
        } catch (emailError) {
          logger.error("Success email failed", { error: emailError.message, email: user.email });
        }
      });
      logger.info("Email verified successfully", { userId: user._id, email: user.email });
      return { message: "Email verified successfully" };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error("Email verification failed", { error: error.message });
      throw new ApiError(500, "Email verification failed");
    }
  }

  // 🔥 SEND EMAIL VERIFICATION SUCCESS
  static async sendEmailVerificationSuccess(user, req) {
    try {
      const userAgent = req.get ? req.get("User-Agent") : req.headers?.["user-agent"] || "Unknown";
      const ip = req.ip || req.connection?.remoteAddress || "Unknown";
      const getDeviceInfo = (ua) => {
        const sanitizedUA = String(ua || "").replace(/[<>"'&]/g, "");
        const os = sanitizedUA.includes("Windows")
          ? "Windows"
          : sanitizedUA.includes("Mac")
            ? "macOS"
            : sanitizedUA.includes("Linux")
              ? "Linux"
              : sanitizedUA.includes("Android")
                ? "Android"
                : sanitizedUA.includes("iOS")
                  ? "iOS"
                  : "Unknown";
        const platform = sanitizedUA.includes("Mobile")
          ? "Mobile"
          : sanitizedUA.includes("Tablet")
            ? "Tablet"
            : "Desktop";
        return { os, platform };
      };
      const deviceInfo = getDeviceInfo(userAgent);
      const verificationTime = new Date().toLocaleString("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
      await emailService.sendEmail({
        to: user.email,
        subject: "✅ Email Verified Successfully - EndlessChatt",
        template: "email-verification-success",
        context: {
          firstName: user.firstName,
          username: user.username,
          email: user.email,
          ip,
          platform: deviceInfo.platform,
          os: deviceInfo.os,
          verificationTime,
          loginUrl: `${process.env.FRONTEND_URL}/login`,
        },
      });
      logger.info("Email verification success email sent", {
        email: user.email,
        username: user.username,
        ip,
        os: deviceInfo.os,
        platform: deviceInfo.platform,
      });
    } catch (emailError) {
      logger.error("Email verification success email failed", { error: emailError.message, email: user.email });
    }
  }

  // 🔥 INVALIDATE ALL USER SESSIONS
  static async invalidateAllUserSessions(userId) {
    try {
      // Clear refresh token from database
      await User.findByIdAndUpdate(userId, {
        $unset: { refreshToken: 1 },
        "security.lastPasswordChange": new Date(),
      });
      // Clear all user-related cache entries
      await Promise.all([
        // Clear user cache
        redisClient.del(`user:${userId}`).catch(() => {}),
        // Clear all session patterns
        redisClient.del(`sessions:${userId}:*`).catch(() => {}),
        // Clear any cached tokens
        redisClient.del(`tokens:${userId}:*`).catch(() => {}),
        // Force logout by clearing refresh token patterns
        redisClient.del(`refresh:${userId}:*`).catch(() => {}),
      ]);
      logger.info("All user sessions invalidated", { userId });
      return true;
    } catch (error) {
      logger.error("Session invalidation failed", { error: error.message, userId });
      // Don't throw - this shouldn't break the password change flow
      return false;
    }
  }

  // 🔥 RESEND VERIFICATION EMAIL
  static async resendVerificationEmail(user, req) {
    try {
      // Generate new verification token
      const verificationToken = user.generateEmailVerificationToken();
      await user.save({ validateBeforeSave: false });
      // Send verification email
      await this.sendWelcomeEmail(user, verificationToken, req);
      logger.info("Verification email resent", { userId: user._id, email: user.email });
      return { message: "Verification email sent successfully" };
    } catch (error) {
      logger.error("Failed to resend verification email", { error: error.message, userId: user._id });
      throw new ApiError(500, "Failed to send verification email");
    }
  }

  // 🔥 BUILD SECURITY OVERVIEW
  static async buildSecurityOverview(user) {
    try {
      // Process activity log efficiently
      const recentLogins =
        user.activityLog
          ?.filter((log) => log.action === "login")
          ?.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          ?.slice(0, 5) || [];
      const lastSuccessfulLogin =
        user.activityLog
          ?.filter((log) => log.action === "login" && log.success)
          ?.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;
      return {
        accountSecurity: {
          isEmailVerified: user.isEmailVerified || false,
          twoFactorEnabled: user.security?.twoFactorEnabled || false,
          lastPasswordChange: user.security?.lastPasswordChange || null,
          failedLoginAttempts: user.security?.failedLoginAttempts || 0,
          isAccountLocked: user.security?.lockUntil ? user.security.lockUntil > new Date() : false,
          passwordResetCount: user.security?.passwordResetCount || 0,
        },
        recentActivity: {
          lastLogin: lastSuccessfulLogin,
          lastActive: user.lastActive || null,
          recentLogins,
          totalLoginAttempts: user.activityLog?.filter((log) => log.action === "login")?.length || 0,
        },
        deviceInfo: {
          lastLoginIP: user.security?.lastLoginIP || null,
          lastLoginLocation: user.security?.lastLoginLocation || null,
        },
        securityScore: this.calculateSecurityScore(user),
      };
    } catch (error) {
      logger.error("Failed to build security overview", { error: error.message, userId: user._id });
      throw new ApiError(500, "Failed to generate security overview");
    }
  }

  // 🔥 CALCULATE SECURITY SCORE
  static calculateSecurityScore(user) {
    let score = 0;
    const maxScore = 100;
    // Email verification (20 points)
    if (user.isEmailVerified) {
      score += 20;
    }
    // Two-factor authentication (30 points)
    if (user.security?.twoFactorEnabled) {
      score += 30;
    }
    // Recent password change (20 points)
    const lastPasswordChange = user.security?.lastPasswordChange;
    if (lastPasswordChange) {
      const daysSinceChange = (Date.now() - new Date(lastPasswordChange)) / (1000 * 60 * 60 * 24);
      if (daysSinceChange < 90) {
        score += 20;
      } else if (daysSinceChange < 180) {
        score += 10;
      } // Changed within 180 days
    }
    // No recent failed attempts (15 points)
    if ((user.security?.failedLoginAttempts || 0) === 0) {
      score += 15;
    }
    // Account not locked (15 points)
    const isLocked = user.security?.lockUntil ? user.security.lockUntil > new Date() : false;
    if (!isLocked) {
      score += 15;
    }
    return {
      score: Math.min(score, maxScore),
      maxScore,
      level: score >= 80 ? "High" : score >= 60 ? "Medium" : "Low",
      recommendations: this.getSecurityRecommendations(user, score),
    };
  }

  // 🔥 GET SECURITY RECOMMENDATIONS
  static getSecurityRecommendations(user, currentScore) {
    const recommendations = [];

    if (!user.isEmailVerified) {
      recommendations.push("Verify your email address to improve account security");
    }

    if (!user.security?.twoFactorEnabled) {
      recommendations.push("Enable two-factor authentication for enhanced security");
    }

    const lastPasswordChange = user.security?.lastPasswordChange;
    if (!lastPasswordChange || Date.now() - new Date(lastPasswordChange) > 180 * 24 * 60 * 60 * 1000) {
      recommendations.push("Consider changing your password regularly (every 6 months)");
    }

    if ((user.security?.failedLoginAttempts || 0) > 0) {
      recommendations.push("Review recent login attempts and secure your account if needed");
    }

    if (currentScore < 60) {
      recommendations.push("Your account security is below recommended levels. Please follow the suggestions above.");
    }

    return recommendations;
  }

  // 🔥 ASYNC ACTIVITY LOGGING (Non-blocking)
  static async logActivity(user, action, req, success = true, errorMessage = null) {
    try {
      // Use worker queue for heavy operations in production
      const activityData = {
        userId: user._id,
        email: user.email,
        action,
        ip: req.ip || req.connection?.remoteAddress || "127.0.0.1",
        userAgent: req.get("User-Agent") || "Unknown",
        timestamp: new Date(),
        success,
        errorMessage,
      };
      // Store in Redis queue for processing
      await redisClient.lpush("activity_log", JSON.stringify(activityData));
      // Keep queue size manageable
      await redisClient.ltrim("activity_log", 0, 9999);
    } catch (error) {
      logger.error("Activity logging failed", { error: error.message, userId: user._id });
      // Never throw - logging should not affect user experience
    }
  }
}

export { AuthService };
