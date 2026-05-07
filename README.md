# Health Check Service

A lightweight, production-grade health check service that monitors HTTP endpoints, classifies their status, and exposes results via a `/health` endpoint and Prometheus-compatible `/metrics` endpoint.

Built as a submission for the **Platforms Developer Officer Intern** assignment at Npontu Technologies.

---

## Overview

The service polls a configurable list of HTTP endpoints on a fixed interval, measures their response time and status code, and classifies each result as `UP`, `DEGRADED`, `DOWN`, or `STALE`. The latest results are cached in memory and served on demand through a JSON API and a Prometheus metrics endpoint, decoupling check frequency from request frequency.

### Why this design

A naive health checker performs the downstream HTTP calls on every incoming `/health` request. That approach has two serious problems: requests become slow (waiting on outbound calls) and the downstream services get hammered (load amplifies with the number of monitoring callers). This service uses an **asynchronous polling pattern** instead — a background worker pulls on a schedule, and `/health` simply reads the latest cached results. Response times are sub-millisecond and downstream load is bounded regardless of how many monitoring callers are active.

---

## Architecture

```
                  ┌─────────────────┐
                  │ endpoints.json  │  (list of endpoints to check)
                  └────────┬────────┘
                           │ loaded at startup
                           ▼
    ┌──────────────────────────────────────┐
    │           CHECKER                    │
    │  Every N seconds, in parallel:       │
    │   - send HTTP GET request            │
    │   - measure latency                  │
    │   - classify UP / DEGRADED / DOWN    │──┐
    └──────────────────────────────────────┘  │
                                                ▼
                          ┌────────────────────────────┐
                          │  STATE STORE (in-memory)   │
                          │  Map<name, latestResult>   │
                          └────────────────────────────┘
                                                ▲
                                                │
    ┌──────────────────────────────────────┐  │
    │       HTTP SERVER (Express)          │  │
    │  GET /health   → JSON status         │──┘
    │  GET /metrics  → Prometheus format   │
    │  GET /         → service info        │
    └──────────────────────────────────────┘
```

The three layers are deliberately decoupled:

- **Checker** (`src/checker.js`) — performs outbound HTTP requests with `AbortController`-enforced timeouts, classifies results, and writes to the store.
- **Store** (`src/store.js`) — an in-memory `Map` of the latest result per endpoint, with a singleton export so all modules share state.
- **Server** (`src/server.js`) — reads from the store and exposes JSON/Prometheus endpoints.

---

## Status classification

| Condition | Status |
|---|---|
| 2xx/3xx response, latency < `degradedThresholdMs` | `UP` |
| 2xx/3xx response, latency ≥ `degradedThresholdMs` | `DEGRADED` |
| 4xx or 5xx response | `DOWN` |
| Network error / timeout / connection refused | `DOWN` |
| Last check older than `intervalMs × stalenessMultiplier` | `STALE` |
| Service just started, no checks completed yet | `UNKNOWN` |

The overall service status is computed as: any `DOWN` → overall `DOWN`; otherwise any `DEGRADED` or `STALE` → overall `DEGRADED`; otherwise `UP`.

---

## Quick start

### Prerequisites

- Node.js ≥ 20 (developed and tested on Node 24)
- npm ≥ 9

### Install and run

```bash
git clone <repo-url>
cd health-check-service
npm install
npm start
```

The service starts on port `3000` by default. You should see structured startup logs and the first check pass complete within a couple of seconds.

### Try it out

```bash
curl http://localhost:3000/         # service info
curl http://localhost:3000/health   # health report (JSON)
curl http://localhost:3000/metrics  # Prometheus metrics
```

### Development mode

```bash
npm run dev
```

Uses Node's built-in `--watch` flag to auto-restart on file changes.

### Run tests

```bash
npm test
```

Uses Node's built-in test runner. No Jest or Mocha dependency.

---

## Configuration

### Endpoints

Edit `config/endpoints.json` to define which endpoints to monitor:

```json
[
  {
    "name": "github-api",
    "url": "https://api.github.com",
    "timeoutMs": 5000,
    "degradedThresholdMs": 1000
  }
]
```

| Field | Required | Default | Description |
|---|---|---|---|
| `name` | yes | — | Unique identifier used in metrics labels and store keys |
| `url` | yes | — | Full URL to GET |
| `timeoutMs` | no | 5000 | Abort the request after this many milliseconds |
| `degradedThresholdMs` | no | 1000 | Latency above this marks the result as `DEGRADED` |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server listen port |
| `CHECK_INTERVAL_MS` | `30000` | Time between check passes |
| `STALENESS_MULTIPLIER` | `2` | Mark data stale if older than `intervalMs × this` |
| `ENDPOINTS_FILE` | `config/endpoints.json` | Path to the endpoints config |
| `LOG_LEVEL` | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `NODE_ENV` | unset | Set to `production` to disable pretty-printed logs |

---

## API

### `GET /health`

Returns overall service status and per-endpoint detail.

**Response (200 if `UP`, 503 otherwise):**

```json
{
  "status": "DEGRADED",
  "timestamp": "2026-05-07T14:45:13.554Z",
  "uptimeSeconds": 128,
  "checks": [
    {
      "name": "github-api",
      "url": "https://api.github.com",
      "status": "UP",
      "httpStatus": 200,
      "latencyMs": 736,
      "lastChecked": "2026-05-07T14:45:07.104Z",
      "consecutiveFailures": 0,
      "lastError": null,
      "ageMs": 6449
    }
  ]
}
```

The HTTP status code follows convention: `200` if the service is fully `UP`, `503 Service Unavailable` otherwise. This lets load balancers and orchestrators consume `/health` directly without parsing the body.

### `GET /metrics`

Returns metrics in Prometheus exposition format. Custom metrics include:

- `health_checks_total{endpoint, status}` — counter of all checks performed
- `health_endpoint_status{endpoint}` — gauge with `1` (UP), `0.5` (DEGRADED), or `0` (DOWN)
- `health_check_latency_ms{endpoint}` — histogram of check latencies for percentile analysis

Default Node.js process metrics (memory, CPU, GC, event loop lag) are also included.

---

## Production considerations

Several production patterns are built in:

- **Timeouts on every outbound request** via `AbortController` — prevents hanging downstream services from stalling the checker.
- **Parallel check execution** via `Promise.all` — total pass time equals the slowest check, not the sum.
- **Staleness detection** — if the checker stalls, `/health` will mark endpoints `STALE` rather than reporting frozen data.
- **Graceful shutdown** on `SIGTERM` and `SIGINT` — stops the checker, drains in-flight requests, and exits cleanly within a 10-second deadline.
- **Structured JSON logging** via Pino — production logs flow directly into log aggregators (ELK, Loki, Datadog).
- **Conventional HTTP status codes** — `/health` returns `503` when unhealthy so external monitors can react without body parsing.
- **Security hardening** — `X-Powered-By` header disabled, error responses don't leak stack traces, no secrets in source.

---

## Containerized deployment

A multi-stage `Dockerfile` is included.

```bash
docker build -t health-check-service .
docker run -p 3000:3000 health-check-service
```

The Dockerfile uses a multi-stage build to keep the runtime image small, runs as a non-root user (`node`), and includes a Docker `HEALTHCHECK` directive that uses the service's own `/health` endpoint.

---

## Project structure

```
health-check-service/
├── src/
│   ├── index.js           Application entry point and shutdown
│   ├── config.js          Config loading and validation
│   ├── checker.js         Background polling worker
│   ├── store.js           In-memory state store
│   ├── server.js          Express HTTP server
│   ├── logger.js          Centralized Pino logger
│   └── metrics.js         Prometheus metrics registry
├── tests/
│   ├── store.test.js
│   └── checker.test.js
├── config/
│   └── endpoints.json
├── Dockerfile
├── .dockerignore
├── .gitignore
├── package.json
├── README.md
└── ANALYSIS.md
```

---

## Tech stack and rationale

| Choice | Why |
|---|---|
| **Node.js 24** | Modern LTS, native `fetch`, native test runner, native `--watch`, native `.env` loading |
| **Express 5** | Industry-standard, minimal, mature; v5 (2024) fixed long-standing async issues |
| **Pino** | Fastest Node logger; structured JSON output by default; drop-in for log aggregators |
| **prom-client** | Official Prometheus client library |
| **Built-in `fetch`** | Avoids `axios` dependency; matches modern Node best practice |
| **Built-in `node --test`** | Avoids Jest/Mocha; sufficient for this scope; one less dependency to audit |

Total runtime dependencies: **3** (`express`, `pino`, `prom-client`). Total dev dependencies: **1** (`pino-pretty`). The minimal footprint is itself a security and reliability signal.

---