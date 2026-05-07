// src/server.js
//
// Express HTTP server exposing:
//   GET /         - simple service info
//   GET /health   - JSON health report (200 if healthy, 503 if not)
//   GET /metrics  - Prometheus-format metrics
//
// The server reads from the State Store; it does NOT trigger checks.
// This keeps responses fast and decouples request rate from check rate.

import express from 'express';
import { store } from './store.js';
import { registry } from './metrics.js';
import { logger } from './logger.js';

/**
 * Build and return the Express app.
 * @param {object} config - Validated app config (used for staleness threshold)
 */
export function createServer(config) {
  const app = express();

  // Disable the X-Powered-By header — small but standard security hardening.
  // Don't advertise your stack to attackers ("privacy and security by design").
  app.disable('x-powered-by');

  // Lightweight request logger.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info({
        method: req.method,
        url: req.url,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }, 'request');
    });
    next();
  });

  /**
   * Root endpoint — basic service info.
   */
  app.get('/', (req, res) => {
    res.json({
      service: 'health-check-service',
      endpoints: ['/health', '/metrics'],
    });
  });

  /**
   * /health — primary health endpoint.
   *
   * Detects stale data: if the most recent check is older than
   * (intervalMs * stalenessMultiplier), we mark that endpoint STALE.
   * This protects against the "checker silently died" failure mode.
   *
   * HTTP status code follows convention:
   *   200 if overall status is UP
   *   503 otherwise (Service Unavailable — standard for unhealthy)
   */
  app.get('/health', (req, res) => {
    const stalenessThresholdMs = config.intervalMs * config.stalenessMultiplier;
    const now = Date.now();

    // Snapshot the store and apply staleness detection.
    const checks = store.getAll().map((result) => {
      const lastCheckedMs = new Date(result.lastChecked).getTime();
      const ageMs = now - lastCheckedMs;
      if (ageMs > stalenessThresholdMs) {
        return { ...result, status: 'STALE', ageMs };
      }
      return { ...result, ageMs };
    });

    // Recompute overall status from the (possibly staleness-adjusted) checks.
    let overall;
    if (checks.length === 0) {
      overall = 'UNKNOWN';
    } else {
      const statuses = checks.map((c) => c.status);
      if (statuses.includes('DOWN')) overall = 'DOWN';
      else if (statuses.includes('STALE') || statuses.includes('DEGRADED')) overall = 'DEGRADED';
      else overall = 'UP';
    }

    const httpStatus = overall === 'UP' ? 200 : 503;

    res.status(httpStatus).json({
      status: overall,
      timestamp: new Date().toISOString(),
      uptimeSeconds: store.uptimeSeconds(),
      checks,
    });
  });

  /**
   * /metrics — Prometheus scrape endpoint.
   * Returns metrics in Prometheus exposition format (text/plain).
   */
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      logger.error({ err }, 'Failed to render metrics');
      res.status(500).end();
    }
  });

  // 404 handler.
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Error handler — last line of defense. Don't leak stack traces.
  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}