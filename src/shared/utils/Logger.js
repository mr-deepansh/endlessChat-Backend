import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Logger {
  constructor(module = "App") {
    this.module = module;
    this.logDir = path.join(__dirname, "../../../logs");
    this.streams = {};
    this.maxFileSize = 100 * 1024 * 1024; // 100 MB
    this.compressAfterDays = parseInt(process.env.LOG_COMPRESS_AFTER_DAYS) || 1;
    this.retentionDays = parseInt(process.env.LOG_RETENTION_DAYS) || 30;

    this.ensureLogDirectory();
    this.manageLogs();

    if (!Logger._cleanupHookRegistered) {
      process.on("exit", () => {
        Object.values(this.streams).forEach((s) => s.end && s.end());
      });
      Logger._cleanupHookRegistered = true;
    }
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  manageLogs() {
    try {
      const files = fs.readdirSync(this.logDir);
      const now = Date.now();
      const compressAge = this.compressAfterDays * 24 * 60 * 60 * 1000;
      const deleteAge = this.retentionDays * 24 * 60 * 60 * 1000;

      files.forEach((file) => {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);

        if (file.endsWith(".log")) {
          // compress old logs
          if (now - stats.mtimeMs > compressAge) {
            this.compressLog(filePath);
          }
        } else if (file.endsWith(".gz")) {
          // delete very old compressed logs
          if (now - stats.mtimeMs > deleteAge) {
            fs.unlinkSync(filePath);
          }
        }
      });
    } catch (err) {
      process.stderr.write(`Logger: Failed to manage logs - ${err.message}\n`);
    }
  }

  compressLog(filePath) {
    const gzipPath = `${filePath}.gz`;
    if (fs.existsSync(gzipPath)) {
      return;
    } // already compressed

    const gzip = zlib.createGzip();
    const source = fs.createReadStream(filePath);
    const dest = fs.createWriteStream(gzipPath);

    source
      .pipe(gzip)
      .pipe(dest)
      .on("finish", () => {
        fs.unlinkSync(filePath); // remove original after compression
      });
  }

  getLogFile(level, index = 1) {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.logDir, `${level}-${date}-${index}.log`);
  }

  getStream(level) {
    if (!this.streams[level]) {
      this.streams[level] = this.createStream(level);
    }

    const file = this.streams[level].path;
    const stats = fs.existsSync(file) ? fs.statSync(file) : null;

    if (stats && stats.size >= this.maxFileSize) {
      this.streams[level].end();
      delete this.streams[level];

      let index = 1;
      while (fs.existsSync(this.getLogFile(level, index))) {
        index++;
      }

      this.streams[level] = this.createStream(level, index);
    }

    return this.streams[level];
  }

  createStream(level, index = 1) {
    return fs.createWriteStream(this.getLogFile(level, index), { flags: "a" });
  }

  formatMessage(level, message, meta = {}) {
    return `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      module: this.module,
      message,
      ...meta,
    })}\n`;
  }

  writeToFile(level, message, meta) {
    try {
      const stream = this.getStream(level);
      if (stream && stream.writable) {
        stream.write(this.formatMessage(level, message, meta));
      }
    } catch (err) {
      process.stderr.write(`Logger: Failed to write log [${level}] - ${err.message}\n`);
    }
  }

  info(message, meta = {}) {
    if (process.env.NODE_ENV === "production") {
      this.writeToFile("info", message, meta);
    }
  }

  error(message, meta = {}) {
    this.writeToFile("error", message, meta);
  }

  warn(message, meta = {}) {
    if (process.env.NODE_ENV === "production") {
      this.writeToFile("warn", message, meta);
    }
  }

  debug(message, meta = {}) {
    if (process.env.NODE_ENV === "development") {
      this.writeToFile("debug", message, meta);
    }
  }

  success(message, meta = {}) {
    if (process.env.NODE_ENV === "production") {
      this.writeToFile("info", message, { ...meta, type: "success" });
    }
  }
}

Logger._cleanupHookRegistered = false;

export { Logger };
