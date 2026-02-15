// src/modules/admin/services/exportImport.service.js
import { User } from "../../users/models/user.model.js";
import { ApiError } from "../../../shared/utils/ApiError.js";
import fs from "fs/promises";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import csv from "fast-csv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ExportImportService {
  async processCSVImport({ filePath, options, progressCallback }) {
    const { skipDuplicates = true, updateExisting = false, validateOnly = false, batchSize = 500, adminId } = options;

    const result = {
      totalProcessed: 0,
      successful: 0,
      duplicates: 0,
      errors: 0,
      details: {
        createdUsers: [],
        updatedUsers: [],
        duplicateEmails: [],
        errors: [],
      },
    };

    try {
      const fileContent = await fs.readFile(filePath, "utf-8");
      const rows = await this.parseCSV(fileContent);

      if (rows.length === 0) {
        throw new Error("CSV file is empty or invalid");
      }

      const batch = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        result.totalProcessed++;

        try {
          const userData = this.validateUserRow(row);

          if (skipDuplicates) {
            const existingUser = await User.findOne({ email: userData.email });
            if (existingUser) {
              result.duplicates++;
              result.details.duplicateEmails.push(userData.email);
              continue;
            }
          }

          if (updateExisting) {
            const existingUser = await User.findOne({ email: userData.email });
            if (existingUser) {
              if (!validateOnly) {
                await User.findByIdAndUpdate(existingUser._id, {
                  ...userData,
                  updatedAt: new Date(),
                  lastModifiedBy: adminId,
                });
              }
              result.successful++;
              result.details.updatedUsers.push(userData.email);
              continue;
            }
          }

          if (!validateOnly) {
            batch.push({
              ...userData,
              createdAt: new Date(),
              createdBy: adminId,
            });
          }

          if (batch.length >= batchSize) {
            if (!validateOnly) {
              await User.insertMany(batch);
              result.successful += batch.length;
              result.details.createdUsers.push(...batch.map((u) => u.email));
            } else {
              result.successful += batch.length;
            }
            batch.length = 0;
          }

          if (progressCallback) {
            progressCallback({
              processed: result.totalProcessed,
              total: rows.length,
              successful: result.successful,
              errors: result.errors,
            });
          }
        } catch (error) {
          result.errors++;
          result.details.errors.push({
            row: i + 1,
            email: row.email || "unknown",
            error: error.message,
          });
        }
      }

      if (batch.length > 0 && !validateOnly) {
        await User.insertMany(batch);
        result.successful += batch.length;
        result.details.createdUsers.push(...batch.map((u) => u.email));
      }
    } catch (error) {
      throw new Error(`CSV processing failed: ${error.message}`);
    }

    return result;
  }

  async streamExport({ res, format, filters, fields, filename, options }) {
    const { includeDeleted = false, adminId } = options;

    const query = { ...filters };
    if (!includeDeleted) {
      query.deletedAt = { $exists: false };
    }

    const projection =
      fields && fields.length > 0
        ? fields.reduce((acc, field) => ({ ...acc, [field]: 1 }), {})
        : { password: 0, refreshToken: 0, __v: 0 };

    res.setHeader("Content-Type", this.getContentType(format));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const userStream = User.find(query, projection).cursor();

    if (format === "csv") {
      const csvStream = csv.format({ headers: true });
      csvStream.pipe(res);

      userStream.on("data", (user) => {
        const userData = this.formatUserForExport(user, fields);
        csvStream.write(userData);
      });

      userStream.on("end", () => {
        csvStream.end();
      });
    } else if (format === "json") {
      res.write("[\n");
      let isFirst = true;

      userStream.on("data", (user) => {
        const userData = this.formatUserForExport(user, fields);
        if (!isFirst) {
          res.write(",\n");
        }
        res.write(JSON.stringify(userData, null, 2));
        isFirst = false;
      });

      userStream.on("end", () => {
        res.write("\n]");
        res.end();
      });
    } else {
      throw new Error(`Unsupported export format: ${format}`);
    }

    userStream.on("error", (error) => {
      console.error("Export stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Export failed" });
      }
    });
  }

  async streamSearchExport({ res, users, format, filename, metadata }) {
    res.setHeader("Content-Type", this.getContentType(format));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    if (format === "csv") {
      const csvStream = csv.format({ headers: true });
      csvStream.pipe(res);

      users.forEach((user, index) => {
        const userData = this.formatUserForExport(user);
        if (index === 0) {
          userData.metadata = JSON.stringify(metadata);
        }
        csvStream.write(userData);
      });

      csvStream.end();
    } else if (format === "json") {
      res.write(
        JSON.stringify(
          {
            metadata,
            users: users.map((user) => this.formatUserForExport(user)),
          },
          null,
          2,
        ),
      );
      res.end();
    } else {
      throw new Error(`Unsupported export format: ${format}`);
    }
  }

  async cleanupFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.warn("Failed to cleanup file:", error.message);
    }
  }

  async parseCSV(content) {
    return new Promise((resolve, reject) => {
      const rows = [];
      csv
        .parseString(content, { headers: true })
        .on("data", (row) => rows.push(row))
        .on("end", () => resolve(rows))
        .on("error", (error) => reject(error));
    });
  }

  validateUserRow(row) {
    const requiredFields = ["email", "username"];
    const missingFields = requiredFields.filter((field) => !row[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    if (!this.isValidEmail(row.email)) {
      throw new Error(`Invalid email format: ${row.email}`);
    }

    return {
      email: row.email.trim().toLowerCase(),
      username: row.username.trim(),
      firstName: row.firstName?.trim() || "",
      lastName: row.lastName?.trim() || "",
      role: row.role || "user",
      isActive: row.isActive !== "false",
      isVerified: row.isVerified === "true",
    };
  }

  formatUserForExport(user, fields = null) {
    const userData = {
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      role: user.role,
      isActive: user.isActive,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
    };

    if (fields && fields.length > 0) {
      const filteredData = {};
      fields.forEach((field) => {
        if (userData[field] !== undefined) {
          filteredData[field] = userData[field];
        }
      });
      return filteredData;
    }

    return userData;
  }

  getContentType(format) {
    switch (format.toLowerCase()) {
      case "csv":
        return "text/csv";
      case "json":
        return "application/json";
      case "xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      default:
        return "application/octet-stream";
    }
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
