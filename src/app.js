// src/app.js
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import timeout from "connect-timeout";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

// Custom middlewares
import { apiRateLimiter } from "./shared/middleware/rateLimit.middleware.js";
import corsMiddleware from "./shared/middleware/cors.middleware.js";

// Configurations
import { serverConfig } from "./config/index.js";

// Shared utilities
import { ApiError } from "./shared/index.js";
import { globalErrorHandler } from "./shared/utils/ErrorHandler.js";

// Route imports
import adminRoutes from "./modules/admin/routes/admin.routes.js";
import authRoutes from "./modules/auth/routes/auth.routes.js";
import forgotPasswordRoutes from "./modules/auth/routes/forgotPassword.routes.js";
import resetPasswordRoutes from "./modules/auth/routes/resetPassword.routes.js";
import userRoutes from "./modules/users/routes/user.routes.js";
import blogRoutes from "./modules/blogs/routes/blog.routes.js";
import notificationRoutes from "./modules/notifications/routes/notification.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.set("trust proxy", 1);
app.use(timeout("60s"));
app.use(compression());

// ========================================
// SECURITY MIDDLEWARE
// ========================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// ========================================
// CORS MIDDLEWARE
// ========================================
app.use(corsMiddleware);

// ========================================
// BODY PARSING MIDDLEWARE
// ========================================
app.use(express.json({ limit: serverConfig.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: serverConfig.bodyLimit }));
app.use(cookieParser());

// ========================================
// LOGGING MIDDLEWARE
// ========================================
if (serverConfig.nodeEnv === "development") {
  app.use((req, res, next) => {
    const startTime = Date.now();
    console.log(`\n📥 ${req.method} ${req.originalUrl}`);
    console.log(`🌐 Origin: ${req.headers.origin || "None"}`);
    console.log("📝 Query:", Object.keys(req.query).length ? req.query : "None");
    console.log("📦 Body:", Object.keys(req.body).length ? req.body : "None");
    console.log("🔑 Headers:", {
      "content-type": req.headers["content-type"] || "None",
      authorization: req.headers.authorization ? "Present" : "Missing",
      "user-agent": req.headers["user-agent"] ? `${req.headers["user-agent"].substring(0, 50)}...` : "None",
    });
    const originalEnd = res.end;
    res.end = function (...args) {
      const duration = Date.now() - startTime;
      console.log(`⏱️  Response: ${res.statusCode} (${duration}ms)`);
      originalEnd.apply(res, args);
    };
    next();
  });
} else {
  app.use(morgan("combined"));
}

// ========================================
// RATE LIMITING
// ========================================
app.use(apiRateLimiter);
app.use("/public", express.static(path.join(__dirname, "../Public")));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use("/favicon.ico", express.static(path.join(__dirname, "../Public/favicon.ico")));

// ========================================
// HEALTH CHECK ROUTES
// ========================================
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    version: serverConfig.apiVersion,
    environment: serverConfig.nodeEnv,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
      total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
    },
  });
});

// API version endpoint
app.get(`/api/${serverConfig.apiVersion}`, (req, res) => {
  res.status(200).json({
    success: true,
    message: `endlessChatt API ${serverConfig.apiVersion} is running successfully`,
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: `/api/${serverConfig.apiVersion}/auth`,
      users: `/api/${serverConfig.apiVersion}/users`,
      blogs: `/api/${serverConfig.apiVersion}/blogs`,
      admin: `/api/${serverConfig.apiVersion}/admin`,
      notifications: `/api/${serverConfig.apiVersion}/notifications`,
    },
  });
});

// ========================================
// API ROUTES
// ========================================
const apiRouter = express.Router();

apiRouter.use("/admin", adminRoutes);
apiRouter.use("/auth", forgotPasswordRoutes);
apiRouter.use("/auth", resetPasswordRoutes);
apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", userRoutes);
apiRouter.use("/blogs", blogRoutes);
apiRouter.use("/notifications", notificationRoutes);

// API 404 handler
apiRouter.use("*", (req, res, next) => {
  const error = new ApiError(404, `API Route Not Found: ${req.method} ${req.originalUrl}`);
  next(error);
});

// Mount API router
app.use(`/api/${serverConfig.apiVersion}`, apiRouter);

// ========================================
// ROOT ROUTE
// ========================================
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "🎉 Welcome to endlessChatt API",
    version: serverConfig.apiVersion,
    environment: serverConfig.nodeEnv,
    docs: `/api/${serverConfig.apiVersion}`,
    health: "/health",
    timestamp: new Date().toISOString(),
  });
});

// ========================================
// GLOBAL 404 HANDLER
// ========================================
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route Not Found",
    path: req.originalUrl,
    method: req.method,
    availableRoutes: {
      api: `/api/${serverConfig.apiVersion}`,
      health: "/health",
      root: "/",
    },
    timestamp: new Date().toISOString(),
  });
});

// ========================================
// GLOBAL ERROR HANDLER
// ========================================
app.use(globalErrorHandler);

export default app;
