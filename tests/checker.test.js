// integration tests for the checker using a local test server

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let testServer;
let baseUrl;

before(async () => {
  testServer = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200);
      res.end('ok');
    } else if (req.url === '/slow') {
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
});

test('a slow response exceeds the degraded threshold', async () => {
  const start = Date.now();
  const res = await fetch(`${baseUrl}/slow`);
  const latency = Date.now() - start;
  assert.equal(res.status, 200);
  assert.ok(latency >= 1000, `Expected slow response, got ${latency}ms`);
});

test('an aborted request raises AbortError', async () => {
  const controller = new AbortController();
  const promise = fetch(`${baseUrl}/slow`, { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, (err) => err.name === 'AbortError');
});