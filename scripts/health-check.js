#!/usr/bin/env node

import http from "http";
import https from "https";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 5000;
const HOST = "localhost";
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === "true";
const TIMEOUT = 5000;

const healthCheck = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: "/health",
      method: "GET",
      timeout: TIMEOUT,
      rejectUnauthorized: false,
    };

    const protocol = HTTPS_ENABLED ? https : http;
    const req = protocol.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve({ status: "healthy", statusCode: res.statusCode, data: JSON.parse(data) });
        } else {
          reject({ status: "unhealthy", statusCode: res.statusCode, data });
        }
      });
    });

    req.on("error", (error) => {
      reject({ status: "error", error: error.message });
    });

    req.on("timeout", () => {
      req.destroy();
      reject({ status: "timeout", error: "Health check timed out" });
    });

    req.end();
  });
};

const main = async () => {
  try {
    const result = await healthCheck();
    console.log("✅ Service is healthy");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("❌ Service is unhealthy");
    console.error(JSON.stringify(error, null, 2));
    process.exit(1);
  }
};

main();
