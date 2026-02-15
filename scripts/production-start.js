#!/usr/bin/env node
// scripts/production-start.js
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const checkPort = async (port) => {
  try {
    // Validate and sanitize port number
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error("Invalid port number");
    }

    // Windows command to check port - using sanitized port
    const { stdout } = await execAsync(`netstat -ano | findstr :${portNum}`);
    return stdout.trim().length > 0;
  } catch {
    return false; // Port is free
  }
};

const killProcessOnPort = async (port) => {
  try {
    // Validate and sanitize port number
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error("Invalid port number");
    }

    const { stdout } = await execAsync(`netstat -ano | findstr :${portNum}`);
    const lines = stdout.trim().split("\n");

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];

      // Validate PID is numeric and reasonable
      const pidNum = parseInt(pid, 10);
      if (pidNum && !isNaN(pidNum) && pidNum > 0 && pidNum < 999999) {
        console.log(`🔄 Killing process ${pidNum} on port ${portNum}`);
        await execAsync(`taskkill /PID ${pidNum} /F`);
      }
    }
  } catch (error) {
    console.log(`⚠️  Could not kill process on port ${port}: ${error.message}`);
  }
};

const startProduction = async () => {
  // Validate port from environment
  const envPort = process.env.PORT || "5000";
  const port = parseInt(envPort, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("❌ Invalid PORT environment variable");
    process.exit(1);
  }

  console.log("🚀 Starting production server...");

  // Check if port is in use
  const portInUse = await checkPort(port);

  if (portInUse) {
    console.log(`⚠️  Port ${port} is in use`);

    if (process.env.FORCE_KILL === "true") {
      console.log("🔄 Force killing existing processes...");
      await killProcessOnPort(port);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
    } else {
      console.log("❌ Port conflict detected. Options:");
      console.log("   1. Set FORCE_KILL=true to kill existing processes");
      console.log("   2. Use different PORT in environment");
      console.log("   3. Stop existing processes manually");
      process.exit(1);
    }
  }

  // Start with PM2
  try {
    console.log("📦 Starting with PM2...");
    await execAsync("pm2 start ecosystem.config.cjs --env production");
    console.log("✅ Production server started successfully");

    // Show status
    const { stdout } = await execAsync("pm2 status");
    console.log("\n📊 PM2 Status:");
    console.log(stdout);
  } catch (error) {
    console.error("❌ Failed to start production server:", error.message);
    process.exit(1);
  }
};

// Handle CLI arguments
if (process.argv.includes("--force")) {
  process.env.FORCE_KILL = "true";
}

startProduction().catch(console.error);
