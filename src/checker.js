import { store } from './store.js';
import { recordCheck } from './metrics.js';
import { logger } from './logger.js';

async function checkOne(endpoint) {
  const { name, url, timeoutMs, degradedThresholdMs } = endpoint;
  const startedAt = Date.now();

  // cancel the fetch if it takes too long
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
    });

    const latencyMs = Date.now() - startedAt;

    let status;
    if (response.status >= 200 && response.status < 400) {
      status = latencyMs >= degradedThresholdMs ? 'DEGRADED' : 'UP';
    } else {
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
    clearTimeout(timer);
  }
}

// check all endpoints at the same time instead of one by one
async function runCheckPass(endpoints) {
  const results = await Promise.all(endpoints.map(checkOne));
  for (const result of results) {
    store.set(result.name, result);
    recordCheck(result);
    logger.debug({ check: result }, `Checked ${result.name}: ${result.status}`);
  }
  return results;
}

export function startChecker({ endpoints, intervalMs }) {
  // run once right away so /health has data before the first interval fires
  runCheckPass(endpoints).catch((err) => {
    logger.error({ err }, 'Initial check pass failed');
  });

  const handle = setInterval(() => {
    runCheckPass(endpoints).catch((err) => {
      logger.error({ err }, 'Check pass failed');
    });
  }, intervalMs);

  return function stopChecker() {
    clearInterval(handle);
  };
}