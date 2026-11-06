# 🚀 Monitoring Setup Guide

Complete guide to setting up Grafana dashboard monitoring for the Stellar Footprint Service.

## 📋 Prerequisites

- Docker and Docker Compose installed
- Git installed
- Basic understanding of Prometheus and Grafana

## 🔧 Installation Steps

### Step 1: Clone and Setup

```bash
# Clone the repository
git clone https://github.com/Mossad-esc/stellar-footprint-engine.git
cd stellar-footprint-engine

# Checkout the monitoring branch
git checkout feature/grafana-dashboard

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### Step 2: Install Dependencies

```bash
# Install prom-client for metrics
pnpm add prom-client

# Install all dependencies
pnpm install
```

### Step 3: Build the Service

```bash
# Build TypeScript
pnpm run build

# Or run in development mode
pnpm run dev
```

### Step 4: Start Monitoring Stack

```bash
# Start all services with Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# Check if all services are running
docker-compose -f docker-compose.prod.yml ps

# Expected output:
# NAME                          STATUS    PORTS
# stellar-footprint-service     Up        0.0.0.0:3000->3000/tcp
# prometheus                    Up        0.0.0.0:9090->9090/tcp
# grafana                       Up        0.0.0.0:3001->3000/tcp
# redis                         Up        0.0.0.0:6379->6379/tcp
```

### Step 5: Verify Services

```bash
# Check Stellar service health
curl http://localhost:3000/health

# Check metrics endpoint
curl http://localhost:3000/metrics

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets
```

### Step 6: Access Grafana

1. Open browser: http://localhost:3001
2. Login with credentials:
   - Username: `admin`
   - Password: `admin` (or your configured password)
3. Dashboard should be automatically loaded

### Step 7: Verify Dashboard

The dashboard should show 7 panels:

1. ✅ Request Rate
2. ✅ Error Rate
3. ✅ Latency Percentiles (P50, P95, P99)
4. ✅ Cache Hit Rate
5. ✅ Active Simulations
6. ✅ Status Code Distribution
7. ✅ Network Usage Distribution

## 🧪 Testing the Dashboard

### Generate Test Traffic

```bash
# Test successful simulation
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "xdr": "AAAAAgAAAADZ1Q...",
    "network": "testnet"
  }'

# Test error handling (missing XDR)
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "network": "testnet"
  }'

# Generate load (requires Apache Bench)
ab -n 1000 -c 10 -p test-payload.json -T application/json \
  http://localhost:3000/api/simulate
```

### Create Test Payload

```bash
# Create test-payload.json
cat > test-payload.json << 'EOF'
{
  "xdr": "AAAAAgAAAADZ1Q...",
  "network": "testnet"
}
EOF
```

### Load Testing Script

```bash
# Create load-test.sh
cat > load-test.sh << 'EOF'
#!/bin/bash
for i in {1..100}; do
  curl -X POST http://localhost:3000/api/simulate \
    -H "Content-Type: application/json" \
    -d '{"xdr":"test","network":"testnet"}' \
    -s -o /dev/null &
  sleep 0.1
done
wait
echo "Load test complete"
EOF

chmod +x load-test.sh
./load-test.sh
```

## 📊 Dashboard Verification Checklist

After generating test traffic, verify each panel:

- [ ] **Request Rate**: Shows increasing line graph
- [ ] **Error Rate**: Shows percentage (should be low)
- [ ] **Latency Percentiles**: Shows P50, P95, P99 lines
- [ ] **Cache Hit Rate**: Shows percentage (may be 0 initially)
- [ ] **Active Simulations**: Shows gauge (0 when idle)
- [ ] **Status Code Distribution**: Shows pie chart with 200, 400, 500
- [ ] **Network Usage**: Shows testnet/mainnet distribution

## 🔍 Troubleshooting

### Dashboard Shows "No Data"

**Problem**: Panels show "No data" message

**Solutions**:

1. Check if metrics endpoint is working:

   ```bash
   curl http://localhost:3000/metrics
   ```

2. Verify Prometheus is scraping:

   ```bash
   # Check Prometheus targets
   open http://localhost:9090/targets
   ```

3. Check if service is instrumented:

   ```bash
   # Should see metrics like http_requests_total
   curl http://localhost:3000/metrics | grep http_requests_total
   ```

4. Verify time range in Grafana (top-right corner)

### Prometheus Not Scraping

**Problem**: Prometheus shows target as "DOWN"

**Solutions**:

1. Check network connectivity:

   ```bash
   docker-compose -f docker-compose.prod.yml exec prometheus \
     wget -qO- http://stellar-footprint-service:3000/metrics
   ```

2. Verify prometheus.yml configuration:

   ```bash
   cat monitoring/prometheus.yml
   ```

3. Check service logs:
   ```bash
   docker-compose -f docker-compose.prod.yml logs stellar-footprint-service
   ```

### Grafana Can't Connect to Prometheus

**Problem**: Grafana shows "Data source error"

**Solutions**:

1. Check Prometheus is running:

   ```bash
   docker-compose -f docker-compose.prod.yml ps prometheus
   ```

2. Verify data source configuration:
   - Go to Configuration → Data Sources
   - Check URL is `http://prometheus:9090`
   - Click "Save & Test"

3. Check network:
   ```bash
   docker-compose -f docker-compose.prod.yml exec grafana \
     wget -qO- http://prometheus:9090/api/v1/query?query=up
   ```

### Metrics Not Updating

**Problem**: Dashboard shows old data

**Solutions**:

1. Check refresh interval (top-right, should be 30s)
2. Verify service is receiving requests
3. Check Prometheus scrape interval in prometheus.yml
4. Restart services:
   ```bash
   docker-compose -f docker-compose.prod.yml restart
   ```

## 📸 Taking Screenshots for PR

```bash
# Generate traffic first
./load-test.sh

# Wait 30 seconds for metrics to populate

# Take screenshots of:
# 1. Full dashboard view
# 2. Request Rate panel (zoomed)
# 3. Latency Percentiles panel (zoomed)
# 4. Prometheus targets page (http://localhost:9090/targets)
```

## 🧹 Cleanup

```bash
# Stop all services
docker-compose -f docker-compose.prod.yml down

# Remove volumes (WARNING: deletes all data)
docker-compose -f docker-compose.prod.yml down -v

# Remove images
docker-compose -f docker-compose.prod.yml down --rmi all
```

## 📝 Commit and Push

```bash
# Stage all monitoring files
git add monitoring/
git add docker-compose.prod.yml
git add Dockerfile
git add healthcheck.js
git add .env.example
git add src/middleware/metrics.ts
git add src/index.ts
git add src/api/controllers.ts

# Commit with conventional commit message
git commit -m "feat: add Grafana dashboard for service metrics

- Add Grafana dashboard with 7 panels
- Implement Prometheus metrics collection
- Add Docker Compose production setup
- Include health check endpoint
- Add metrics middleware for request tracking
- Configure automatic dashboard provisioning

Closes #37"

# Push to remote
git push origin feature/grafana-dashboard
```

## 🔐 Production Considerations

Before deploying to production:

1. **Change default passwords**:

   ```env
   GRAFANA_PASSWORD=your_secure_password_here
   ```

2. **Enable HTTPS**:
   - Use reverse proxy (nginx, Traefik)
   - Configure SSL certificates

3. **Secure Prometheus**:
   - Add authentication
   - Restrict network access
   - Use firewall rules

4. **Configure retention**:

   ```yaml
   # In prometheus.yml
   storage:
     tsdb:
       retention.time: 30d
       retention.size: 10GB
   ```

5. **Set up alerting**:
   - Configure Alertmanager
   - Add alert rules
   - Set up notification channels

6. **Monitor resource usage**:
   - Set memory limits in docker-compose
   - Monitor disk usage
   - Configure log rotation

## 📚 Additional Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [prom-client GitHub](https://github.com/siimon/prom-client)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

## ✅ Success Criteria

Your monitoring setup is complete when:

- ✅ All Docker containers are running
- ✅ Grafana dashboard loads without errors
- ✅ All 7 panels display data after test traffic
- ✅ Prometheus shows target as "UP"
- ✅ Metrics endpoint returns valid Prometheus format
- ✅ Health check endpoint returns 200 OK
- ✅ Dashboard auto-refreshes every 30 seconds

---

**Need help?** Open an issue or check the [main monitoring README](README.md)
