// src/store.js
//
// The State Store is an in-memory cache of the latest health check results.
// It's deliberately simple: a Map keyed by endpoint name.
//
// In production, this might be Redis or a database for cross-instance sharing,
// but for a single-instance service, in-memory is correct and fastest.

class HealthStore {
  constructor() {
    // Map<endpointName, resultObject>
    // Using Map (not plain object) because:
    //   1. It's optimized for frequent additions/lookups
    //   2. It preserves insertion order (predictable iteration)
    //   3. It has a clean .size property
    this.results = new Map();

    // Track when the service itself started, so we can report uptime.
    this.startedAt = Date.now();
  }

  /**
   * Store the latest result for a given endpoint.
   * Called by the Checker after every poll.
   *
   * @param {string} name - Unique identifier for the endpoint
   * @param {object} result - The check result (status, latency, timestamp, etc.)
   */
  set(name, result) {
    this.results.set(name, result);
  }

  /**
   * Retrieve the latest result for a given endpoint.
   * Returns undefined if the endpoint hasn't been checked yet.
   */
  get(name) {
    return this.results.get(name);
  }

  /**
   * Return all results as an array, suitable for JSON serialization.
   * Used by the /health endpoint to build its response.
   */
  getAll() {
    return Array.from(this.results.values());
  }

  /**
   * Compute the overall service status based on individual endpoint statuses.
   * Logic:
   *   - If any endpoint is DOWN  -> overall DOWN
   *   - Else if any is DEGRADED  -> overall DEGRADED
   *   - Else if any is STALE     -> overall DEGRADED (stale data is suspect)
   *   - Else                     -> UP
   *   - If no results at all     -> UNKNOWN (service just started)
   */
  overallStatus() {
    const all = this.getAll();
    if (all.length === 0) return 'UNKNOWN';

    const statuses = all.map((r) => r.status);
    if (statuses.includes('DOWN')) return 'DOWN';
    if (statuses.includes('DEGRADED') || statuses.includes('STALE')) return 'DEGRADED';
    return 'UP';
  }

  /**
   * How long the service itself has been running, in seconds.
   */
  uptimeSeconds() {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }
}

// Export a single shared instance (singleton pattern).
// Every module that imports `store` gets the same instance,
// which is exactly what we want — one source of truth for state.
export const store = new HealthStore();