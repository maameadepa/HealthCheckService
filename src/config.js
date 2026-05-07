// src/config.js
//
// Loads endpoint definitions from config/endpoints.json and runtime settings
// from environment variables. Validates everything at startup so misconfiguration
// fails fast — better to crash on launch than silently behave wrong in production.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load and validate the application configuration.
 * Throws if anything is invalid — caller should treat this as fatal.
 */
export function loadConfig() {
  // Runtime settings from env (with sensible defaults).
  const port = parseInt(process.env.PORT || '3000', 10);
  const intervalMs = parseInt(process.env.CHECK_INTERVAL_MS || '30000', 10);
  const stalenessMultiplier = parseFloat(process.env.STALENESS_MULTIPLIER || '2');

  // Endpoints from JSON file.
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

  // Validate the endpoints array.
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new Error('endpoints.json must contain a non-empty array');
  }

  // Validate each endpoint and apply defaults.
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

  // Check for duplicate names — would silently overwrite in the store.
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