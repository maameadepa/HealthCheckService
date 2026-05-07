// src/checker.js
//
// The Checker is responsible for periodically polling each configured endpoint,
// classifying the response, and writing the result to the State Store.
//
// It runs on a setInterval timer and uses AbortController to enforce per-request
// timeouts — without timeouts, a hanging downstream service could stall the checker.

import { store } from './store.js';
import { recordCheck } from './metrics.js';
import { logger } from './logger.js';

/**
 * Perform a single health check against one endpoint.
 *
 * @param {object} endpoint - { name, url, timeoutMs, degradedThresholdMs }
 * @returns {Promise<object>} Result object to be stored
 */
async function checkOne(endpoint) {
  const { name, url, timeoutMs, degradedThresholdMs } = endpoint;
  const startedAt = Date.now();

  // AbortController lets us cancel the fetch if it exceeds our timeout.
  // Without this, fetch could wait indefinitely on a slow service —
  // tying up resources and making OUR service unhealthy too.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      // Don't follow redirects automatically — a redirect from a
      // health endpoint usually indicates misconfiguration.
      redirect: 'manual',
    });

    const latencyMs = Date.now() - startedAt;

    // Classify the result based on status code and latency.
    let status;
    if (response.status >= 200 && response.status < 400) {
      // Successful response — now check if it was fast enough.
      status = latencyMs >= degradedThresholdMs ? 'DEGRADED' : 'UP';
    } else {
      // 4xx or 5xx — service responded but with an error.
      status = 'DOWN';
    }

    return {
      name,
      url,
      status,
      httpStatus: response.status,
      latencyMs,
      lastChecked: new Date().toISOString(),
      consecutiveFailures: status === 'DOWN'
        ? (store.get(name)?.consecutiveFailures ?? 0) + 1
        : 0,
      lastError: null,
    };
  } catch (error) {
    // Network error, DNS failure, timeout, connection refused — all land here.
    const latencyMs = Date.now() - startedAt;
    const isTimeout = error.name === 'AbortError';

    return {
      name,
      url,
      status: 'DOWN',
      httpStatus: null,
      latencyMs,
      lastChecked: new Date().toISOString(),
      consecutiveFailures: (store.get(name)?.consecutiveFailures ?? 0) + 1,
      lastError: isTimeout
        ? `Timeout after ${timeoutMs}ms`
        : error.message,
    };
  } finally {
    // Always clear the timer, whether the fetch succeeded or threw.
    // Forgetting this would leak timers — a subtle memory leak in long-running services.
    clearTimeout(timer);
  }
}

/**
 * Run a check pass over all configured endpoints in parallel.
 * Parallel execution matters: if we checked sequentially, total time
 * would equal the sum of all timeouts in the worst case.
 */
async function runCheckPass(endpoints) {
  const results = await Promise.all(endpoints.map(checkOne));
  for (const result of results) {
    store.set(result.name, result);
    recordCheck(result);
    logger.debug({ check: result }, `Checked ${result.name}: ${result.status}`);
  }
  return results;
}

/**
 * Start the Checker. Runs an immediate first pass, then schedules
 * subsequent passes at the configured interval.
 *
 * Returns a function that stops the checker (used during graceful shutdown).
 */
export function startChecker({ endpoints, intervalMs }) {
  // Immediate first pass so /health has data ASAP after startup.
    runCheckPass(endpoints).catch((err) => {
        logger.error({ err }, 'Initial check pass failed');
    });

  // Schedule subsequent passes.
  const handle = setInterval(() => {
    runCheckPass(endpoints).catch((err) => {
        logger.error({ err }, 'Check pass failed');
    });
  }, intervalMs);

  // Returning the stop function lets the entry point cleanly shut down.
  return function stopChecker() {
    clearInterval(handle);
  };
}