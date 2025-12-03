// src/modules/users/models/user.model.js
import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";
import Jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new Schema(
  {
    username: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      lowercase: true,
    },
    email: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      lowercase: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    bio: {
      type: String,
      default: "",
    },
    password: {
      type: String,
      minlength: 8,
      required: [true, "Password is required"],
    },
    role: {
      type: String,
      enum: ["user", "admin", "super_admin"],
      default: "user",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    refreshToken: String,
    forgotPasswordToken: String,
    forgotPasswordExpiry: Date,
    emailVerificationToken: String,
    emailVerificationExpiry: Date,
    avatar: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },
    coverImage: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },
    followers: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],
    following: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],
    watchHistory: [
      {
        type: Schema.Types.ObjectId,
        ref: "Video",
      },
    ],
    preferences: {
      theme: {
        type: String,
        enum: ["light", "dark"],
        default: "light",
      },
      emailNotifications: {
        type: Boolean,
        default: true,
      },
      pushNotifications: {
        type: Boolean,
        default: true,
      },
    },
    // Enterprise Security & Tracking
    security: {
      lastPasswordChange: {
        type: Date,
        default: Date.now,
      },
      passwordHistory: [
        {
          password: String,
          createdAt: { type: Date, default: Date.now },
        },
      ],
      failedLoginAttempts: {
        type: Number,
        default: 0,
      },
      lockUntil: Date,
      lastLoginIP: String,
      lastLoginLocation: String,
      twoFactorEnabled: {
        type: Boolean,
        default: false,
      },
      twoFactorSecret: String,
    },
    // Activity Tracking
    activityLog: [
      {
        action: {
          type: String,
          enum: ["login", "logout", "register", "password_reset", "profile_update", "email_change"],
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        deviceInfo: {
          userAgent: String,
          os: String,
          platform: String,
          browser: String,
          device: String,
        },
        location: {
          ip: String,
          country: String,
          region: String,
          city: String,
          timezone: String,
        },
        success: {
          type: Boolean,
          default: true,
        },
        errorMessage: String,
      },
    ],
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

// Enterprise indexes for performance and security
// Note: username and email unique indexes are already created by schema definition
userSchema.index({ followers: 1 });
userSchema.index({ following: 1 });
userSchema.index({ refreshToken: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ "security.lastLoginIP": 1 });
userSchema.index({ "activityLog.timestamp": -1 });
userSchema.index({ lastActive: -1 });
userSchema.index({ isEmailVerified: 1 });

// Virtual for full name
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for followers count
userSchema.virtual("followersCount").get(function () {
  return this.followers?.length || 0;
});

// Virtual for following count
userSchema.virtual("followingCount").get(function () {
  return this.following?.length || 0;
});

// Ensure virtuals are included in JSON output
userSchema.set("toJSON", { virtuals: true });
userSchema.set("toObject", { virtuals: true });
userSchema.pre("save", async function (next) {
  // Handle password hashing
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }

  // Fix coverImage and avatar schema migration
  if (typeof this.coverImage === "string") {
    this.coverImage = { url: this.coverImage || "", publicId: "" };
  }
  if (typeof this.avatar === "string") {
    this.avatar = { url: this.avatar || "", publicId: "" };
  }

  next();
});

userSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function () {
  return Jwt.sign(
    {
      _id: this._id,
      email: this.email,
      username: this.username,
      firstName: this.firstName,
      lastName: this.lastName,
      bio: this.bio,
      avatar: this.avatar?.url || "",
      role: this.role,
      isActive: this.isActive,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    },
  );
};

userSchema.methods.generateRefreshToken = function () {
  return Jwt.sign(
    {
      _id: this._id,
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    },
  );
};

userSchema.methods.generateForgotPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");
  this.forgotPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  this.forgotPasswordExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes
  return resetToken;
};

userSchema.methods.generateEmailVerificationToken = function () {
  const verificationToken = crypto.randomBytes(32).toString("hex");
  this.emailVerificationToken = crypto.createHash("sha256").update(verificationToken).digest("hex");
  this.emailVerificationExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return verificationToken;
};

userSchema.methods.addActivityLog = function (action, deviceInfo, location, success = true, errorMessage = null) {
  this.activityLog.push({
    action,
    deviceInfo,
    location,
    success,
    errorMessage,
  });

  // Keep only last 50 activity logs
  if (this.activityLog.length > 50) {
    this.activityLog = this.activityLog.slice(-50);
  }

  this.lastActive = new Date();
};

userSchema.methods.isAccountLocked = function () {
  return !!(this.security.lockUntil && this.security.lockUntil > Date.now());
};

userSchema.methods.incrementFailedLoginAttempts = function () {
  if (this.security.lockUntil && this.security.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { "security.lockUntil": 1, "security.failedLoginAttempts": 1 },
    });
  }

  const updates = { $inc: { "security.failedLoginAttempts": 1 } };

  // Lock account after 5 failed attempts for 30 minutes
  if (this.security.failedLoginAttempts + 1 >= 5 && !this.security.lockUntil) {
    updates.$set = { "security.lockUntil": Date.now() + 30 * 60 * 1000 };
  }

  return this.updateOne(updates);
};

userSchema.methods.resetFailedLoginAttempts = function () {
  return this.updateOne({
    $unset: { "security.lockUntil": 1, "security.failedLoginAttempts": 1 },
  });
};

export const User = mongoose.model("User", userSchema);
