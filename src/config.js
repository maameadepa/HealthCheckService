import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadConfig() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const intervalMs = parseInt(process.env.CHECK_INTERVAL_MS || '30000', 10);
  const stalenessMultiplier = parseFloat(process.env.STALENESS_MULTIPLIER || '2');

  const endpointsPath = resolve(
    process.env.ENDPOINTS_FILE || 'config/endpoints.json'
  );

  let endpoints;
  try {
    const raw = readFileSync(endpointsPath, 'utf8');
    endpoints = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to load endpoints from ${endpointsPath}: ${err.message}`);
  }

  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new Error('endpoints.json must contain a non-empty array');
  }

  // validate each entry and fill in defaults for optional fields
  endpoints = endpoints.map((ep, i) => {
    if (!ep.name || typeof ep.name !== 'string') {
      throw new Error(`endpoint[${i}]: missing or invalid "name"`);
    }
    if (!ep.url || typeof ep.url !== 'string') {
      throw new Error(`endpoint[${i}]: missing or invalid "url"`);
    }
    try {
      // eslint-disable-next-line no-new
      new URL(ep.url);
    } catch {
      throw new Error(`endpoint[${i}] "${ep.name}": malformed URL`);
    }
    return {
      name: ep.name,
      url: ep.url,
      timeoutMs: ep.timeoutMs ?? 5000,
      degradedThresholdMs: ep.degradedThresholdMs ?? 1000,
    };
  });

  // duplicate names would overwrite each other in the store
  const names = endpoints.map((e) => e.name);
  if (new Set(names).size !== names.length) {
    throw new Error('endpoints.json contains duplicate "name" values');
  }

  return {
    port,
    intervalMs,
    stalenessMultiplier,
    endpoints,
  };
}