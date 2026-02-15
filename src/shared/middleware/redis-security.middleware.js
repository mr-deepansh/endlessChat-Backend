// Redis Security Middleware - Prevent dangerous commands
import { logger } from "../services/logger.service.js";

// Dangerous Redis commands that should be blocked in production
const DANGEROUS_COMMANDS = [
  "FLUSHDB",
  "FLUSHALL",
  "KEYS",
  "CONFIG",
  "SHUTDOWN",
  "BGREWRITEAOF",
  "BGSAVE",
  "SAVE",
  "DEBUG",
  "SLAVEOF",
  "REPLICAOF",
  "SYNC",
  "PSYNC",
  "SCRIPT",
  "EVAL",
  "EVALSHA",
  "MODULE",
  "MIGRATE",
  "RESTORE",
  "DUMP",
];

export const createSecureRedisClient = (client, clientName = "default") => {
  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    return client;
  }

  // Wrap dangerous commands
  DANGEROUS_COMMANDS.forEach((cmd) => {
    const originalMethod = client[cmd.toLowerCase()];

    if (typeof originalMethod === "function") {
      client[cmd.toLowerCase()] = function (...args) {
        logger.error(`Blocked dangerous Redis command: ${cmd}`, {
          client: clientName,
          command: cmd,
          environment: process.env.NODE_ENV,
        });
        throw new Error(`Redis command ${cmd} is disabled in production for security`);
      };
    }
  });

  // Add command monitoring
  client.on("command", (command) => {
    if (DANGEROUS_COMMANDS.includes(command.name?.toUpperCase())) {
      logger.warn(`Attempted dangerous Redis command: ${command.name}`, {
        client: clientName,
        command: command.name,
      });
    }
  });

  return client;
};

export default createSecureRedisClient;
