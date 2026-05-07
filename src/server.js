import express from 'express';
import { store } from './store.js';
import { registry } from './metrics.js';
import { logger } from './logger.js';

export function createServer(config) {
  const app = express();

  app.disable('x-powered-by');

  // log every incoming request with how long it took
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

  app.get('/', (req, res) => {
    res.json({
      service: 'health-check-service',
      endpoints: ['/health', '/metrics'],
    });
  });

  app.get('/health', (req, res) => {
    const stalenessThresholdMs = config.intervalMs * config.stalenessMultiplier;
    const now = Date.now();

    // flag any endpoint we haven't heard from in a while as STALE
    const checks = store.getAll().map((result) => {
      const lastCheckedMs = new Date(result.lastChecked).getTime();
      const ageMs = now - lastCheckedMs;
      if (ageMs > stalenessThresholdMs) {
        return { ...result, status: 'STALE', ageMs };
      }
      return { ...result, ageMs };
    });

    let overall;
    if (checks.length === 0) {
      overall = 'UNKNOWN';
    } else {
      const statuses = checks.map((c) => c.status);
      if (statuses.includes('DOWN')) overall = 'DOWN';
      else if (statuses.includes('STALE') || statuses.includes('DEGRADED')) overall = 'DEGRADED';
      else overall = 'UP';
    }

    // 503 = service unavailable, used when something is wrong
    const httpStatus = overall === 'UP' ? 200 : 503;

    res.status(httpStatus).json({
      status: overall,
      timestamp: new Date().toISOString(),
      uptimeSeconds: store.uptimeSeconds(),
      checks,
    });
  });

  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      logger.error({ err }, 'Failed to render metrics');
      res.status(500).end();
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}