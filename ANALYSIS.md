# Analysis: Service Failure Behavior and Production Detection

This document accompanies the health check service and answers the questions posed in the assignment: *what happens when one of the monitored services goes down, and how would I detect it in production?*

---

## Part 1: What happens when one service goes down

### 1.1 Failure modes are not all equal

A service "going down" is not a single phenomenon. In practice, failures fall into three categories with very different implications:

| Failure mode | Symptom | Detection difficulty |
|---|---|---|
| **Hard failure** | Connection refused, DNS failure, TCP reset | Easy — the request fails immediately |
| **Timeout / hang** | No response within threshold | Medium — must enforce client-side timeouts |
| **Soft failure** | Responds with 5xx, or 200 but with high latency or wrong content | Hardest — naive checks may miss it |

Soft failures are the most dangerous because the service *appears* to be working. A health check that only verifies "did I get any HTTP response?" will return `UP` for a service that returns 500s on every real request, or one that takes 30 seconds to respond. This is why the service in this repository classifies on **both** status code and latency, and treats responses slower than a configured threshold as `DEGRADED` rather than `UP`.

### 1.2 The cascade problem

In a microservice architecture, services depend on each other. If Service A calls Service B on every request, and B goes down, A can fail in two ways:

- **Fast cascade**: A makes a request to B, B returns an immediate connection error, A returns its own error to its caller. Bad, but contained.
- **Slow cascade**: A makes a request to B, B hangs without responding. A's request thread is now blocked waiting. Under load, A runs out of threads or connections, becomes unresponsive, and starts failing its *own* health checks. The failure has propagated.

Slow cascades are the classic cause of large-scale outages. A single slow downstream can take down an entire dependency graph in minutes. Mitigations that production systems use — and that this service models in miniature — include:

- **Aggressive client-side timeouts** (we use `AbortController` with a configurable `timeoutMs`)
- **Circuit breakers** — after N consecutive failures, stop calling the service entirely for a cooldown period
- **Bulkheads** — isolate dependencies so one slow downstream can't exhaust shared resources
- **Graceful degradation** — return cached or partial data when a non-critical dependency is unavailable, rather than failing the whole request

The `consecutiveFailures` counter exposed in this service's `/health` response is the building block for circuit breakers and alert thresholds.

### 1.3 The thundering herd

When a downed service comes back online, every dependent service that was retrying simultaneously hits it at once. This recovery surge can knock the service over again immediately, producing an oscillating outage. Production systems mitigate this with **exponential backoff with jitter** on retries — each retry waits longer than the last, plus a random offset so retries from different clients don't synchronize.

### 1.4 User-visible vs. internal impact

Not every "down" service produces a user-visible incident. A monitoring service being down is internally bad but invisible to users. A payment service being down may be invisible if cached, or catastrophic if the homepage refuses to load. Production teams maintain a **service criticality matrix** and route alerts accordingly: tier-1 services page on-call immediately; tier-3 services file a ticket for next business day.

---

## Part 2: How to detect failures in production

Detection is a layered problem. No single technique catches everything; production systems combine several.

### 2.1 Health checks (the layer this service implements)

A polling health checker like the one in this repository forms the **first detection layer**. It runs inside the same network as the monitored services, hits each one on a regular interval, and classifies the response. Strengths and limits:

- **Strength**: Cheap, fast, and easy to reason about. The cached results are also a perfect data source for load balancers and orchestrators (Kubernetes readiness probes, AWS target group health checks, etc.).
- **Limit**: Tests the endpoint, not the user experience. A `GET /health` returning 200 doesn't prove that real user transactions work.
- **Limit**: Runs from inside the network, so it misses outages caused by external factors (DNS, CDN, the user's ISP).

This service mitigates the "checker silently dies" failure mode by including a `lastChecked` timestamp on every result and marking endpoints `STALE` if their data exceeds a configurable freshness threshold.

### 2.2 Synthetic monitoring

A synthetic monitor runs from outside the network — typically multiple geographic regions — and performs scripted user journeys (login, search, checkout, etc.). Tools like Pingdom, Datadog Synthetics, or AWS CloudWatch Synthetics handle this. They catch what internal health checks cannot: ISP-level routing issues, certificate expiration, DNS misconfiguration, and CDN failures. In production, internal health checks and synthetic monitoring are complementary, not redundant.

### 2.3 Metrics and alerting

The Prometheus `/metrics` endpoint this service exposes feeds into the standard observability stack:

- **Prometheus** scrapes metrics on a regular interval and stores them as time series.
- **Grafana** visualizes them as dashboards.
- **Alertmanager** evaluates alerting rules against the metrics and routes alerts to PagerDuty, Slack, or email.

Alert rules built on this service's metrics might include:

- `health_endpoint_status{endpoint="payments"} == 0` for 2 minutes → page on-call
- Histogram p95 of `health_check_latency_ms` exceeds 1500ms for 5 minutes → warning notification
- `rate(health_checks_total{status="DOWN"}[5m]) > 0` → record in incident tracker

Defining alerts in terms of **SLOs (Service Level Objectives)** is the modern best practice. Rather than alerting on every blip, an SLO defines an acceptable error budget — for example, "99.9% of health checks should succeed over a rolling 30-day window." Alerts fire only when the budget is being burned faster than the period allows. This dramatically reduces alert fatigue while still catching real problems.

### 2.4 Logs

Structured JSON logs (which this service emits via Pino) flow into a centralized log aggregator like Loki, Elasticsearch, or Splunk. When an alert fires, on-call engineers immediately query the aggregator for the affected service's logs around the incident time. Without structured logs and centralized aggregation, this step becomes a slow scramble through SSH sessions on individual servers.

### 2.5 Distributed tracing

Metrics tell you *that* something is slow; logs tell you *what* happened; traces tell you *where* in the request path the slowness lives. OpenTelemetry-instrumented services emit traces that show, for a single user request, exactly which downstream calls were made and how long each took. For diagnosing a `DEGRADED` status, traces are often the fastest path to root cause.

### 2.6 Putting it together: incident response flow

A complete production setup combines these layers in a well-defined response flow:

1. **Detection** — A check run by this service (or a synthetic monitor) records a `DOWN` status. The metric is scraped by Prometheus.
2. **Alert evaluation** — Alertmanager evaluates a rule like "endpoint DOWN for 3 consecutive checks" and fires.
3. **Notification** — The alert reaches the on-call engineer via PagerDuty, with severity routing based on the affected service's tier.
4. **Triage** — The engineer opens the relevant Grafana dashboard, identifies the impact scope, and queries logs and traces in the affected window.
5. **Mitigation** — Roll back a recent deployment, restart the affected service, or trigger a runbook procedure (failover, scale-up, cache flush).
6. **Resolution and post-mortem** — Once recovered, a blameless post-mortem documents the timeline, root cause, and remediation actions to prevent recurrence.

The health check service in this repository is the foundational piece of step 1. Without reliable detection, every layer above it is useless — you can't respond to an incident you don't know about. Every other piece of production observability ultimately depends on the quality of the signals coming from health checks like these.

---

## Notes from building this service

A few observations from the development process worth recording:

- **Cold-start latency is real**: the first poll of any endpoint shows higher latency due to DNS resolution and TLS handshake overhead. A naive checker would falsely report endpoints as `DEGRADED` on startup. Production-grade checkers either ignore the first sample or use a warm-up period.
- **In-memory state is appropriate for a single instance** but does not survive restarts and does not share state across replicas. A horizontally scaled deployment would need an external store like Redis, with each instance writing its own check results and aggregating reads — at which point new questions arise about consistency and which instance "owns" the truth.
- **HTTP `503` on `/health` is intentional**: it lets load balancers and orchestrators react without parsing the response body. This convention is widely supported and converts the service into a drop-in liveness/readiness probe for Kubernetes or AWS target groups with no extra glue code.
