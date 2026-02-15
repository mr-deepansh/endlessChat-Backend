#!/usr/bin/env node

import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const audit = {
  passed: [],
  warnings: [],
  failed: [],
};

// Check JWT secrets
const checkJWTSecrets = () => {
  const secrets = [
    { name: "JWT_SECRET", value: process.env.JWT_SECRET, minLength: 64 },
    { name: "ACCESS_TOKEN_SECRET", value: process.env.ACCESS_TOKEN_SECRET, minLength: 64 },
    { name: "REFRESH_TOKEN_SECRET", value: process.env.REFRESH_TOKEN_SECRET, minLength: 64 },
  ];

  secrets.forEach(({ name, value, minLength }) => {
    if (!value) {
      audit.failed.push(`${name} is not set`);
    } else if (value.length < minLength) {
      audit.failed.push(`${name} is too short (${value.length} < ${minLength})`);
    } else {
      audit.passed.push(`${name} is properly configured`);
    }
  });
};

// Check Redis security
const checkRedis = () => {
  const password = process.env.REDIS_PASSWORD;

  if (!password) {
    audit.failed.push("REDIS_PASSWORD is not set");
  } else if (password.length < 16) {
    audit.failed.push(`REDIS_PASSWORD is too weak (${password.length} < 16 characters)`);
  } else if (password === "administer" || password.includes("password")) {
    audit.failed.push("REDIS_PASSWORD uses common/weak password");
  } else {
    audit.passed.push("REDIS_PASSWORD is strong");
  }

  if (process.env.REDIS_TLS !== "true" && process.env.NODE_ENV === "production") {
    audit.warnings.push("Redis TLS is not enabled in production");
  }
};

// Check MongoDB security
const checkMongoDB = () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    audit.failed.push("MONGODB_URI is not set");
  } else {
    if (uri.includes("mongodb+srv://")) {
      audit.passed.push("Using MongoDB Atlas (recommended)");
    } else {
      audit.warnings.push("Consider using MongoDB Atlas for production");
    }

    if (uri.includes("localhost") && process.env.NODE_ENV === "production") {
      audit.warnings.push("Using localhost MongoDB in production");
    }
  }
};

// Check encryption
const checkEncryption = () => {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    audit.failed.push("ENCRYPTION_KEY is not set");
  } else if (key.length < 32) {
    audit.failed.push(`ENCRYPTION_KEY is too short (${key.length} < 32)`);
  } else {
    audit.passed.push("ENCRYPTION_KEY is properly configured");
  }
};

// Check HTTPS
const checkHTTPS = () => {
  if (process.env.HTTPS_ENABLED === "true") {
    audit.passed.push("HTTPS is enabled");
  } else if (process.env.NODE_ENV === "production") {
    audit.warnings.push("HTTPS is not enabled in production");
  }
};

// Check CORS
const checkCORS = () => {
  const origin = process.env.CORS_ORIGIN;

  if (origin === "*" && process.env.NODE_ENV === "production") {
    audit.failed.push("CORS_ORIGIN is set to wildcard (*) in production");
  } else if (origin) {
    audit.passed.push("CORS_ORIGIN is properly configured");
  }
};

// Check rate limiting
const checkRateLimit = () => {
  const max = parseInt(process.env.RATE_LIMIT_MAX);

  if (!max) {
    audit.warnings.push("RATE_LIMIT_MAX is not set");
  } else if (max > 1000 && process.env.NODE_ENV === "production") {
    audit.warnings.push(`RATE_LIMIT_MAX is high (${max}) for production`);
  } else {
    audit.passed.push("Rate limiting is configured");
  }
};

// Check password policy
const checkPasswordPolicy = () => {
  const minLength = parseInt(process.env.PASSWORD_MIN_LENGTH) || 8;

  if (minLength < 8) {
    audit.warnings.push(`PASSWORD_MIN_LENGTH is too low (${minLength})`);
  } else {
    audit.passed.push("Password policy is configured");
  }
};

// Run all checks
const runAudit = () => {
  console.log("🔒 Security Audit Report");
  console.log("=".repeat(50));

  checkJWTSecrets();
  checkRedis();
  checkMongoDB();
  checkEncryption();
  checkHTTPS();
  checkCORS();
  checkRateLimit();
  checkPasswordPolicy();

  console.log("\n✅ Passed Checks:", audit.passed.length);
  audit.passed.forEach((item) => console.log(`  ✓ ${item}`));

  if (audit.warnings.length > 0) {
    console.log("\n⚠️  Warnings:", audit.warnings.length);
    audit.warnings.forEach((item) => console.log(`  ⚠ ${item}`));
  }

  if (audit.failed.length > 0) {
    console.log("\n❌ Failed Checks:", audit.failed.length);
    audit.failed.forEach((item) => console.log(`  ✗ ${item}`));
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total: ${audit.passed.length} passed, ${audit.warnings.length} warnings, ${audit.failed.length} failed`);

  if (audit.failed.length > 0) {
    console.log("\n❌ Security audit failed. Please fix the issues above.");
    process.exit(1);
  } else if (audit.warnings.length > 0) {
    console.log("\n⚠️  Security audit passed with warnings.");
    process.exit(0);
  } else {
    console.log("\n✅ Security audit passed successfully!");
    process.exit(0);
  }
};

runAudit();
