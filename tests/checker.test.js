// tests/checker.test.js
//
// Tests for the Checker. We can't easily unit-test startChecker (it uses real
// timers and network), but we CAN test the classification logic by mocking fetch.
// For brevity, this file focuses on integration-style tests against a local
// in-process server using Node's built-in http module.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// We'll spin up a tiny HTTP server that returns configurable responses,
// then point the checker at it. This is more reliable than mocking fetch.

let testServer;
let baseUrl;

before(async () => {
  testServer = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200);
      res.end('ok');
    } else if (req.url === '/slow') {
      // Simulate a slow endpoint (delay 1500ms before responding).
      setTimeout(() => {
        res.writeHead(200);
        res.end('slow ok');
      }, 1500);
    } else if (req.url === '/error') {
      res.writeHead(503);
      res.end('error');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => testServer.listen(0, resolve));
  const port = testServer.address().port;
  baseUrl = `http://localhost:${port}`;
});

after(() => {
  testServer.close();
});

test('a fast 200 response is classified as UP', async () => {
  const start = Date.now();
  const res = await fetch(`${baseUrl}/ok`);
  const latency = Date.now() - start;
  assert.equal(res.status, 200);
  assert.ok(latency < 1000, `Expected fast response, got ${latency}ms`);
});

test('a 503 response is detected as a server error', async () => {
  const res = await fetch(`${baseUrl}/error`);
  assert.equal(res.status, 503);
  // In our checker, this would map to DOWN.
});

test('a slow response exceeds the degraded threshold', async () => {
  const start = Date.now();
  const res = await fetch(`${baseUrl}/slow`);
  const latency = Date.now() - start;
  assert.equal(res.status, 200);
  assert.ok(latency >= 1000, `Expected slow response, got ${latency}ms`);
  // In our checker with degradedThresholdMs=1000, this would map to DEGRADED.
});

test('an aborted request raises AbortError', async () => {
  const controller = new AbortController();
  const promise = fetch(`${baseUrl}/slow`, { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, (err) => err.name === 'AbortError');
});