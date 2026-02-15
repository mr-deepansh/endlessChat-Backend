#!/usr/bin/env node

import os from "os";
import { execSync } from "child_process";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === "true";

// Get network interfaces
const getNetworkInfo = () => {
  const nets = os.networkInterfaces();
  const results = [];

  for (const name in nets) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        results.push({
          interface: name,
          ip: net.address,
          mac: net.mac,
        });
      }
    }
  }
  return results;
};

// Check if service is running
const checkService = () => {
  try {
    const output = execSync(`netstat -ano | findstr :${PORT}`, { encoding: "utf8" });
    return output.includes("LISTENING");
  } catch {
    return false;
  }
};

// Get PM2 process info
const getPM2Info = () => {
  try {
    const output = execSync("pm2 jlist", { encoding: "utf8" });
    const processes = JSON.parse(output);
    const appProcesses = processes.filter((p) => p.name === "social-media-blog-app");
    return appProcesses.length > 0 ? appProcesses : null;
  } catch {
    return null;
  }
};

// Main function
const showServiceInfo = () => {
  const protocol = HTTPS_ENABLED ? "https" : "http";
  const hostname = os.hostname();
  const networks = getNetworkInfo();
  const isRunning = checkService();
  const pm2Process = getPM2Info();

  console.log("🚀 EndlessChat Backend Service Information");
  console.log("=".repeat(50));

  // Basic Info
  console.log(`📍 Environment: ${NODE_ENV}`);
  console.log(`🖥️  Hostname: ${hostname}`);
  console.log(`🔌 Port: ${PORT}`);
  console.log(`🔒 Protocol: ${protocol.toUpperCase()}`);
  console.log(`⚡ Status: ${isRunning ? "✅ RUNNING" : "❌ NOT RUNNING"}`);

  // Network Information
  console.log("\n🌐 Network Interfaces:");
  networks.forEach((net) => {
    console.log(`   ${net.interface}: ${net.ip}`);
  });

  // Service URLs
  console.log("\n🔗 Service URLs:");
  console.log(`   Local:   ${protocol}://localhost:${PORT}`);
  if (networks.length > 0) {
    networks.forEach((net) => {
      console.log(`   Network: ${protocol}://${net.ip}:${PORT}`);
    });
  }

  // API Endpoints
  console.log("\n📡 API Endpoints:");
  const baseUrls = [`${protocol}://localhost:${PORT}`, ...networks.map((net) => `${protocol}://${net.ip}:${PORT}`)];
  baseUrls.forEach((baseUrl, index) => {
    if (index === 0) {
      console.log(`   Health:  ${baseUrl}/health`);
    }
    console.log(`   API:     ${baseUrl}/api/v2`);
    console.log(`   Docs:    ${baseUrl}/api/v2/docs`);
  });

  // PM2 Information
  if (pm2Process && pm2Process.length > 0) {
    console.log("\n🔧 PM2 Process Information:");
    pm2Process.forEach((proc, index) => {
      console.log(
        `   Instance ${index}: PID ${proc.pid || "N/A"} | Status: ${proc.pm2_env?.status || "Unknown"} | CPU: ${proc.monit?.cpu || 0}% | Memory: ${Math.round((proc.monit?.memory || 0) / 1024 / 1024)}MB`,
      );
    });
    const mainProc = pm2Process[0];
    console.log(`   Total Instances: ${pm2Process.length}`);
    console.log(
      `   Uptime: ${mainProc.pm2_env?.pm_uptime ? new Date(mainProc.pm2_env.pm_uptime).toLocaleString() : "N/A"}`,
    );
    console.log(`   Restarts: ${mainProc.pm2_env?.restart_time || 0}`);
  }

  // System Information
  console.log("\n💻 System Information:");
  console.log(`   Platform: ${os.platform()} ${os.arch()}`);
  console.log(`   Node.js: ${process.version}`);
  console.log(`   Total Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
  console.log(`   Free Memory: ${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`);
  console.log(`   CPU Cores: ${os.cpus().length}`);
  console.log(
    `   Load Average: ${os
      .loadavg()
      .map((l) => l.toFixed(2))
      .join(", ")}`,
  );

  console.log(`\n${"=".repeat(50)}`);

  if (!isRunning) {
    console.log("💡 To start the service:");
    console.log("   Development: npm run dev");
    console.log("   Production:  npm run prod:full");
    console.log("   Simple:      npm run prod:simple");
  } else {
    console.log("💡 Service Management:");
    console.log("   Status:      npm run pm2:status");
    console.log("   Logs:        npm run pm2:logs");
    console.log("   Monitor:     npm run pm2:monit");
    console.log("   Restart:     npm run pm2:restart");
  }
};

// Run the script
showServiceInfo();
