// holds the latest check result for each endpoint

class HealthStore {
  constructor() {
    this.results = new Map();
    this.startedAt = Date.now();
  }

  set(name, result) {
    this.results.set(name, result);
  }

  get(name) {
    return this.results.get(name);
  }

  getAll() {
    return Array.from(this.results.values());
  }

  // DOWN beats everything, then DEGRADED/STALE, then UP
  overallStatus() {
    const all = this.getAll();
    if (all.length === 0) return 'UNKNOWN';

    const statuses = all.map((r) => r.status);
    if (statuses.includes('DOWN')) return 'DOWN';
    if (statuses.includes('DEGRADED') || statuses.includes('STALE')) return 'DEGRADED';
    return 'UP';
  }

  uptimeSeconds() {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }
}

// one shared instance so all modules read/write the same data
export const store = new HealthStore();