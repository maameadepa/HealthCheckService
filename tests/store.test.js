// tests/store.test.js
//
// Unit tests for the State Store. Tests are essential because:
//   1. They prove the code works as designed
//   2. They prevent regressions when the code is changed later
//   3. They serve as living documentation of expected behavior
//
// Uses Node's built-in test runner (no Jest/Mocha needed).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import a fresh class instance per test by re-importing.
// We work directly with HealthStore via the singleton for these tests.
import { store } from '../src/store.js';

test('store starts empty with UNKNOWN overall status', () => {
  // Note: store is a singleton, so we clear it for test isolation.
  store.results.clear();
  assert.equal(store.overallStatus(), 'UNKNOWN');
  assert.deepEqual(store.getAll(), []);
});

test('store returns UP when all endpoints are UP', () => {
  store.results.clear();
  store.set('a', { name: 'a', status: 'UP' });
  store.set('b', { name: 'b', status: 'UP' });
  assert.equal(store.overallStatus(), 'UP');
});

test('store returns DEGRADED when any endpoint is DEGRADED', () => {
  store.results.clear();
  store.set('a', { name: 'a', status: 'UP' });
  store.set('b', { name: 'b', status: 'DEGRADED' });
  assert.equal(store.overallStatus(), 'DEGRADED');
});

test('store returns DOWN when any endpoint is DOWN (DOWN beats DEGRADED)', () => {
  store.results.clear();
  store.set('a', { name: 'a', status: 'DOWN' });
  store.set('b', { name: 'b', status: 'DEGRADED' });
  store.set('c', { name: 'c', status: 'UP' });
  assert.equal(store.overallStatus(), 'DOWN');
});

test('getAll returns all stored results', () => {
  store.results.clear();
  store.set('a', { name: 'a', status: 'UP' });
  store.set('b', { name: 'b', status: 'DOWN' });
  const all = store.getAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].name, 'a');
  assert.equal(all[1].name, 'b');
});

test('uptimeSeconds returns a non-negative integer', () => {
  const uptime = store.uptimeSeconds();
  assert.equal(typeof uptime, 'number');
  assert.ok(uptime >= 0);
  assert.ok(Number.isInteger(uptime));
});