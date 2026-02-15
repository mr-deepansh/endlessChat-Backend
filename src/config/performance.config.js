// src/config/performance.config.js

export const performanceConfig = {
  // Cluster configuration for millions of users
  cluster: {
    enabled: process.env.NODE_ENV === "production",
    workers: process.env.CLUSTER_WORKERS || "max", // Use all CPU cores
    maxMemory: "2G",
    killTimeout: 5000,
    listenTimeout: 3000,
    gracefulShutdown: true,
  },

  // Connection pooling for high concurrency
  database: {
    maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 50,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    readPreference: "secondaryPreferred",
    writeConcern: { w: "majority", j: true },
  },

  // Redis configuration for millions of users
  redis: {
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
    maxMemoryPolicy: "allkeys-lru",
    keyPrefix: process.env.REDIS_KEY_PREFIX || "app:",
    connectTimeout: 10000,
    commandTimeout: 5000,
    lazyConnect: true,
    keepAlive: 30000,
    family: 4,
    db: parseInt(process.env.REDIS_DB) || 0,
  },

  // HTTP server optimization
  server: {
    keepAliveTimeout: 65000,
    headersTimeout: 66000,
    requestTimeout: 30000,
    maxHeadersCount: 2000,
    maxRequestsPerSocket: 0,
    timeout: 120000,
    backlog: 511,
  },

  // Compression settings
  compression: {
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return true;
    },
  },

  // Rate limiting for scale
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Per IP
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    keyGenerator: (req) => req.ip,
    handler: (req, res) => {
      res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.round(15 * 60),
      });
    },
  },

  // Memory management
  memory: {
    maxOldSpaceSize: 4096, // 4GB
    maxSemiSpaceSize: 128,
    gcInterval: 60000, // Force GC every minute
    heapSnapshotNearHeapLimit: 3,
  },

  // Caching strategy
  cache: {
    defaultTTL: 3600, // 1 hour
    checkPeriod: 600, // 10 minutes
    maxKeys: 100000,
    updateAgeOnGet: false,
    useClones: false,
  },
};

export default performanceConfig;
