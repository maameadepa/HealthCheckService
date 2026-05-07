// src/metrics.js
//
// Prometheus metrics. Prometheus is the de-facto standard for metrics in
// modern infrastructure (CNCF graduated project). By exposing /metrics in
// Prometheus format, our service plugs into any standard observability stack.

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

// Default Node.js process metrics (memory, CPU, event loop lag, GC, etc.).
// These are invaluable for debugging the health checker itself.
collectDefaultMetrics({ register: registry });

// Counter: total checks performed, labeled by endpoint and result.
// Counters only go up — perfect for "how many times has X happened."
export const checksTotal = new Counter({
  name: 'health_checks_total',
  help: 'Total number of health checks performed',
  labelNames: ['endpoint', 'status'],
  registers: [registry],
});

// Gauge: current status as a number (1=UP, 0.5=DEGRADED, 0=DOWN).
// Gauges can go up or down — perfect for "current state of X."
export const endpointStatus = new Gauge({
  name: 'health_endpoint_status',
  help: 'Current endpoint status (1=UP, 0.5=DEGRADED, 0=DOWN)',
  labelNames: ['endpoint'],
  registers: [registry],
});

// Histogram: distribution of check latencies, bucketed.
// Histograms answer "what's the p50/p95/p99 latency?" — far more useful
// than averages, which hide outliers.
export const checkLatency = new Histogram({
  name: 'health_check_latency_ms',
  help: 'Health check request latency in milliseconds',
  labelNames: ['endpoint'],
  buckets: [50, 100, 250, 500, 1000, 2000, 5000, 10000],
  registers: [registry],
});

/**
 * Record a single check result into all relevant metrics.
 * Called from the checker after each check completes.
 */
export function recordCheck(result) {
  checksTotal.inc({ endpoint: result.name, status: result.status });
  checkLatency.observe({ endpoint: result.name }, result.latencyMs);

  const numericStatus =
    result.status === 'UP' ? 1 : result.status === 'DEGRADED' ? 0.5 : 0;
  endpointStatus.set({ endpoint: result.name }, numericStatus);
}