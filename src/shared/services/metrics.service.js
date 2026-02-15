// src/shared/services/metrics.service.js
import { Logger } from "../utils/Logger.js";

/**
 * MetricsCollector - Production-grade metrics service
 * Supports: counters, gauges, timers, histograms, custom metrics
 * Optimized for millions of events with safe memory handling
 */
export class MetricsCollector {
  constructor(options = {}) {
    this.logger = new Logger("MetricsCollector");

    // Default + custom config
    this.config = {
      flushInterval: options.flushInterval || 60_000, // 1 min
      maxMetricsInMemory: options.maxMetricsInMemory || 10_000,
      enableConsoleOutput: options.enableConsoleOutput ?? true,
      enableFileOutput: options.enableFileOutput ?? false,
      enableRemoteOutput: options.enableRemoteOutput ?? false,
      remoteEndpoint: options.remoteEndpoint || null,
      namespace: options.namespace || "app",
      environment: options.environment || process.env.NODE_ENV || "development",
      ...options,
    };

    // In-memory stores
    this.counters = new Map();
    this.gauges = new Map();
    this.timingMetrics = new Map();
    this.histograms = new Map();
    this.customMetrics = new Map();
    this.metadata = new Map();

    // Periodic flush
    if (this.config.flushInterval > 0) {
      this.startPeriodicFlush();
    }

    this.logger.info("MetricsCollector initialized", {
      flushInterval: this.config.flushInterval,
      namespace: this.config.namespace,
      environment: this.config.environment,
    });
  }

  // -------------------------
  // Core Metric APIs
  // -------------------------

  increment(name, value = 1, tags = {}) {
    this.#safeExec(
      () => {
        const key = this.#metricKey(name, tags);
        this.counters.set(key, (this.counters.get(key) || 0) + value);
        this.#storeMetadata(name, "counter", tags, { value });
      },
      "increment",
      { name, value },
    );
  }

  decrement(name, value = 1, tags = {}) {
    this.increment(name, -value, tags);
  }

  gauge(name, value, tags = {}) {
    this.#safeExec(
      () => {
        const key = this.#metricKey(name, tags);
        this.gauges.set(key, { value, ts: Date.now(), tags: { ...tags } });
        this.#storeMetadata(name, "gauge", tags, { value });
      },
      "gauge",
      { name, value },
    );
  }

  timing(name, duration, tags = {}) {
    this.#safeExec(
      () => {
        const key = this.#metricKey(name, tags);
        if (!this.timingMetrics.has(key)) {
          this.timingMetrics.set(key, []);
        }
        const arr = this.timingMetrics.get(key);
        arr.push({ duration, ts: Date.now() });
        if (arr.length > 1000) {
          arr.splice(0, arr.length - 1000);
        } // cap
        this.#storeMetadata(name, "timing", tags, { duration });
      },
      "timing",
      { name, duration },
    );
  }

  startTimer(name, tags = {}) {
    const start = process.hrtime.bigint();
    const key = `${name}_${Date.now()}_${Math.random()}`;
    return () => {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1e6; // ms
      this.timing(name, duration, tags);
      return duration;
    };
  }

  histogram(name, value, tags = {}) {
    this.#safeExec(
      () => {
        const key = this.#metricKey(name, tags);
        if (!this.histograms.has(key)) {
          this.histograms.set(key, []);
        }
        const arr = this.histograms.get(key);
        arr.push({ value, ts: Date.now() });
        if (arr.length > 1000) {
          arr.splice(0, arr.length - 1000);
        }
        this.#storeMetadata(name, "histogram", tags, { value });
      },
      "histogram",
      { name, value },
    );
  }

  custom(name, value, type = "custom", tags = {}) {
    this.#safeExec(
      () => {
        const key = this.#metricKey(name, tags);
        this.customMetrics.set(key, {
          value,
          type,
          tags: { ...tags },
          ts: Date.now(),
        });
        this.#storeMetadata(name, type, tags, { value });
      },
      "custom",
      { name, value },
    );
  }

  // -------------------------
  // Retrieval APIs
  // -------------------------

  getMetric(name, tags = {}) {
    const key = this.#metricKey(name, tags);
    if (this.counters.has(key)) {
      return this.counters.get(key);
    }
    if (this.gauges.has(key)) {
      return this.gauges.get(key).value;
    }
    if (this.customMetrics.has(key)) {
      return this.customMetrics.get(key).value;
    }
    return null;
  }

  getTimingStats(name, tags = {}) {
    const key = this.#metricKey(name, tags);
    const arr = this.timingMetrics.get(key);
    if (!arr?.length) {
      return null;
    }

    const durations = arr.map((d) => d.duration).sort((a, b) => a - b);
    const percentile = (p) => {
      const idx = (p / 100) * (durations.length - 1);
      const lo = Math.floor(idx),
        hi = Math.ceil(idx);
      if (lo === hi) {
        return durations[lo];
      }
      const w = idx - lo;
      return durations[lo] * (1 - w) + durations[hi] * w;
    };

    return {
      count: durations.length,
      min: durations[0],
      max: durations.at(-1),
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      median: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
    };
  }

  getAllMetrics() {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries([...this.gauges].map(([k, v]) => [k, v.value])),
      timings: Object.fromEntries([...this.timingMetrics].map(([k]) => [k, this.getTimingStats(k)])),
      custom: Object.fromEntries([...this.customMetrics].map(([k, v]) => [k, v.value])),
      meta: {
        total: this.counters.size + this.gauges.size + this.timingMetrics.size + this.customMetrics.size,
        generatedAt: new Date().toISOString(),
        namespace: this.config.namespace,
        environment: this.config.environment,
      },
    };
  }

  // -------------------------
  // Flush / Output
  // -------------------------

  async flush() {
    try {
      const metrics = this.getAllMetrics();
      if (this.config.enableConsoleOutput) {
        this.#outputConsole(metrics);
      }
      if (this.config.enableFileOutput) {
        await this.#outputFile(metrics);
      }
      if (this.config.enableRemoteOutput && this.config.remoteEndpoint) {
        await this.#outputRemote(metrics);
      }
    } catch (err) {
      this.logger.error("Flush failed", { err: err.message });
    }
  }

  startPeriodicFlush() {
    this.flushInterval = setInterval(() => this.flush(), this.config.flushInterval);
    this.logger.info("Periodic flush started", {
      interval: this.config.flushInterval,
    });
  }

  stopPeriodicFlush() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
  }

  async shutdown() {
    this.stopPeriodicFlush();
    await this.flush();
    this.logger.info("MetricsCollector shutdown complete");
  }

  // -------------------------
  // Private helpers
  // -------------------------

  #metricKey(name, tags) {
    if (!Object.keys(tags).length) {
      return name;
    }
    const tagStr = Object.entries(tags)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}|${tagStr}`;
  }

  #storeMetadata(name, type, tags, data) {
    const key = this.#metricKey(name, tags);
    this.metadata.set(key, { name, type, tags, ts: Date.now(), ...data });
  }

  #safeExec(fn, op, ctx) {
    try {
      fn();
    } catch (err) {
      this.logger.error(`Metric ${op} failed`, { ...ctx, err: err.message });
    }
  }

  #outputConsole(metrics) {
    console.log("\n=== METRICS ===");
    console.log(`Generated: ${metrics.meta.generatedAt}`);
    console.log(`Total: ${metrics.meta.total} | Env: ${metrics.meta.environment}\n`);
    Object.entries(metrics.counters).forEach(([k, v]) => console.log(`Counter ${k}: ${v}`));
    console.log("=================\n");
  }

  async #outputFile(metrics) {
    // TODO: integrate with fs/promises or Winston dailyRotateFile
    this.logger.info("File output not implemented");
  }

  async #outputRemote(metrics) {
    // TODO: integrate with Prometheus pushgateway, Datadog, Grafana Loki, etc.
    this.logger.info("Remote output not implemented");
  }
}

export default MetricsCollector;
