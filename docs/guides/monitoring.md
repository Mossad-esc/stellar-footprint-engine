# Monitoring Guide

This guide covers production monitoring for the Stellar Footprint Service using Prometheus and Grafana.

## Architecture Overview

```
┌─────────────────┐    scrape /metrics    ┌─────────────────┐    query    ┌─────────────────┐
│ Stellar Service │──────────────────────▶│   Prometheus    │───────────▶│     Grafana     │
│   (Port 3000)   │                       │   (Port 9090)   │            │   (Port 3001)   │
└─────────────────┘                       └─────────────────┘            └─────────────────┘
```

Prometheus scrapes the `/metrics` endpoint every 5 seconds. Grafana reads from Prometheus and renders the pre-built dashboard. The dashboard is auto-provisioned via `monitoring/grafana-dashboard.json` when using the provided docker-compose stack.

---

## Available Metrics

All metrics are exposed at `GET /metrics` in Prometheus text format. The service uses the `prom-client` library and includes Node.js default metrics prefixed with `stellar_footprint_service_`.

### HTTP Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status_code`, `network` | Total HTTP requests handled |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `network` | Request duration; buckets: 1ms–5s |

**Key derived queries**

```promql
# Request rate (req/s over 5 min)
rate(http_requests_total{job="stellar-footprint-service"}[5m])

# Error rate (%) over 5 min
(
  rate(http_requests_total{status_code=~"[45].."}[5m])
  / rate(http_requests_total[5m])
) * 100

# P95 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

### Simulation Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `simulate_requests_total` | Counter | `network`, `status` (`success`/`failure`) | Simulation attempts by outcome |
| `simulate_duration_seconds` | Histogram | `network` | End-to-end simulation latency; buckets: 100ms–30s |
| `active_simulations` | Gauge | — | Currently in-flight simulations |
| `simulate_request_xdr_bytes` | Histogram | — | Raw XDR payload size; buckets: 256B–64KB |
| `simulate_footprint_entries` | Histogram | `type` | Footprint entries per simulation; buckets: 0–100 |

### Cache Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `cache_hits_total` | Counter | `cache_type` | Cache hits (label value: `simulation`) |
| `cache_misses_total` | Counter | `cache_type` | Cache misses |
| `cache_operation_duration_seconds` | Histogram | `operation` (`get`/`set`), `backend` | Cache latency; buckets: 0.5ms–500ms |

**Key derived query**

```promql
# Cache hit rate (%)
(
  rate(cache_hits_total[5m])
  / (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m]))
) * 100
```

### RPC / Infrastructure Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `rpc_errors_total` | Counter | `network`, `error_type` | RPC errors by network and error category |

### Node.js Default Metrics (auto-collected)

All standard `prom-client` default metrics are exposed with the `stellar_footprint_service_` prefix, including:

- `stellar_footprint_service_process_cpu_seconds_total`
- `stellar_footprint_service_process_resident_memory_bytes`
- `stellar_footprint_service_nodejs_eventloop_lag_seconds`
- `stellar_footprint_service_nodejs_heap_size_used_bytes`
- `stellar_footprint_service_nodejs_active_handles_total`

---

## Starting the Monitoring Stack

### Docker Compose (recommended)

```bash
# Start the full stack: service + Prometheus + Grafana + Redis
docker-compose -f docker-compose.prod.yml up -d

# Verify all containers are running
docker-compose -f docker-compose.prod.yml ps

# Confirm the service exposes metrics
curl http://localhost:3000/metrics | head -20
```

Access points:

| Service | URL | Default credentials |
|---|---|---|
| Stellar Service | http://localhost:3000 | — |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3001 | `admin` / `admin` |

**Change the Grafana password before exposing to the internet.**

### Kubernetes

The service exposes `/metrics` on port `3000`. Add a `ServiceMonitor` (if using the Prometheus Operator) pointing at that port:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: stellar-footprint-service
spec:
  selector:
    matchLabels:
      app: stellar-footprint-service
  endpoints:
    - port: http
      path: /metrics
      interval: 5s
```

---

## Grafana Dashboard Import

The pre-built dashboard is auto-provisioned when using the docker-compose stack. To import it manually:

1. Open Grafana → **Dashboards** → **Import**
2. Click **Upload JSON file**
3. Select `monitoring/grafana-dashboard.json`
4. Choose **Prometheus** as the data source
5. Click **Import**

The dashboard includes panels for: request rate, error rate, P50/P95/P99 latency, cache hit rate, active simulations, and status code distribution.

---

## Key Metrics to Watch

| Metric | Target | Alert threshold |
|---|---|---|
| Error rate (`4xx`+`5xx`) | < 1% | > 5% for 2 min |
| P95 request latency | < 500 ms | > 1 s for 5 min |
| Cache hit rate | > 80% | < 50% for 10 min |
| `active_simulations` | < 50 | > 100 sustained |
| Event loop lag | < 100 ms | > 500 ms |
| Heap used | < 70% of limit | > 85% of limit |

---

## Alerting Rules (`monitoring/prometheus/alerts.yml`)

Production alert rules are defined in `monitoring/prometheus/alerts.yml` and loaded by `monitoring/prometheus.yml` via `rule_files`:

| Alert | Severity | Condition | `for` |
|---|---|---|---|
| `StellarRpcCircuitBreakerOpen` | `critical` | `rpc_circuit_breaker_state == 2` | `30s` |
| `HighSimulationErrorRate` | `warning` | Simulation failure rate > 5% over 5m | `5m` |
| `StellarRpcHighLatency` | `warning` | `simulate_duration_seconds_bucket` p95 > 2s over 5m | `5m` |
| `RedisCacheUnavailable` | `critical` | `redis_up == 0` | `1m` |
| `HighMemoryUtilization` | `warning` | Container memory working set / limit > 85% | `5m` |

### Validating and Unit Testing Alerts

Prometheus alert rules are verified in CI using `promtool` against unit tests in `monitoring/prometheus/alerts.test.yml`:

```bash
# Syntax check
promtool check rules monitoring/prometheus/alerts.yml

# Run unit tests
promtool test rules monitoring/prometheus/alerts.test.yml
```

---

## Troubleshooting

### Prometheus shows the target as `DOWN`

1. Check the target list at http://localhost:9090/targets
2. Confirm the service is running: `curl http://localhost:3000/health`
3. Confirm metrics are exposed: `curl http://localhost:3000/metrics`
4. Check network connectivity between the Prometheus and service containers

### No data in Grafana panels

1. Confirm Prometheus data source is configured (Grafana → **Connections** → **Data sources**)
2. Run a raw query in Prometheus to verify metrics exist: `http_requests_total`
3. Check the Grafana time range — new deployments have no history; zoom in to "Last 5 minutes"

### Container fails to start

```bash
# Inspect logs for all services
docker-compose -f docker-compose.prod.yml logs --tail=50

# Check the service specifically
docker-compose -f docker-compose.prod.yml logs stellar-footprint-service
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GRAFANA_USER` | `admin` | Grafana admin username |
| `GRAFANA_PASSWORD` | `admin` | Grafana admin password — **change in production** |

---

## Further Reading

- [Prometheus configuration reference](monitoring/prometheus.yml)
- [Grafana dashboard JSON](monitoring/grafana-dashboard.json)
- [Monitoring quick start](monitoring/QUICK_START.md)
- [Architecture overview](../architecture.md)
