import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

// adds default node metrics like memory and CPU usage
collectDefaultMetrics({ register: registry });

// how many checks done, broken down by endpoint and result
export const checksTotal = new Counter({
  name: 'health_checks_total',
  help: 'Total number of health checks performed',
  labelNames: ['endpoint', 'status'],
  registers: [registry],
});

// 1 = UP, 0.5 = DEGRADED, 0 = DOWN
export const endpointStatus = new Gauge({
  name: 'health_endpoint_status',
  help: 'Current endpoint status (1=UP, 0.5=DEGRADED, 0=DOWN)',
  labelNames: ['endpoint'],
  registers: [registry],
});

export const checkLatency = new Histogram({
  name: 'health_check_latency_ms',
  help: 'Health check request latency in milliseconds',
  labelNames: ['endpoint'],
  buckets: [50, 100, 250, 500, 1000, 2000, 5000, 10000],
  registers: [registry],
});

export function recordCheck(result) {
  checksTotal.inc({ endpoint: result.name, status: result.status });
  checkLatency.observe({ endpoint: result.name }, result.latencyMs);

  const numericStatus =
    result.status === 'UP' ? 1 : result.status === 'DEGRADED' ? 0.5 : 0;
  endpointStatus.set({ endpoint: result.name }, numericStatus);
}