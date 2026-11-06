# ⚡ Quick Start Guide

Get the Grafana dashboard running in 5 minutes!

## 🚀 Prerequisites

- Docker and Docker Compose installed
- Git configured with user identity
- Node.js and npm installed

## 📝 Step 1: Configure Git (If Not Done)

```bash
git config --global user.email "your.email@example.com"
git config --global user.name "Your Name"
```

## 💾 Step 2: Commit Changes

```bash
cd stellar-footprint-engine

# Stage all files
git add .

# Commit
git commit -m "feat: add Grafana dashboard for service metrics

Closes #37"

# Push
git push origin feature/grafana-dashboard
```

## 📦 Step 3: Install Dependencies

```bash
# Install prom-client
npm install prom-client

# Install all dependencies
npm install
```

## 🐳 Step 4: Start Services

```bash
# Copy environment file
cp .env.example .env

# Start Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps
```

## ✅ Step 5: Verify

```bash
# Health check
curl http://localhost:3000/health

# Metrics
curl http://localhost:3000/metrics

# Open Grafana
open http://localhost:3001
# Login: admin / admin
```

## 🧪 Step 6: Test

```bash
# Send test request
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{"xdr":"test","network":"testnet"}'

# Generate load
for i in {1..50}; do
  curl -X POST http://localhost:3000/api/simulate \
    -H "Content-Type: application/json" \
    -d '{"xdr":"test","network":"testnet"}' \
    -s -o /dev/null &
done
```

## 📊 Step 7: View Dashboard

1. Go to http://localhost:3001
2. Login with `admin` / `admin`
3. Dashboard should load automatically
4. Wait 30 seconds for data to populate
5. All 7 panels should show metrics

## 🎯 Access Points

- **Grafana Dashboard**: http://localhost:3001
- **Prometheus**: http://localhost:9090
- **Service API**: http://localhost:3000
- **Metrics Endpoint**: http://localhost:3000/metrics
- **Health Check**: http://localhost:3000/health

## 🛑 Stop Services

```bash
docker-compose -f docker-compose.prod.yml down
```

## 🧹 Clean Up (Remove All Data)

```bash
docker-compose -f docker-compose.prod.yml down -v
```

## 📸 Take Screenshots for PR

```bash
# 1. Generate traffic first
for i in {1..100}; do
  curl -X POST http://localhost:3000/api/simulate \
    -H "Content-Type: application/json" \
    -d '{"xdr":"test","network":"testnet"}' \
    -s -o /dev/null &
done

# 2. Wait 30 seconds

# 3. Take screenshots:
# - Full Grafana dashboard
# - Individual panels (zoomed)
# - Prometheus targets page
```

## 🐛 Troubleshooting

### No Data in Dashboard?

```bash
# Check if metrics are exposed
curl http://localhost:3000/metrics | grep http_requests_total

# Check Prometheus targets
open http://localhost:9090/targets
```

### Services Not Starting?

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs

# Restart services
docker-compose -f docker-compose.prod.yml restart
```

### Port Already in Use?

```bash
# Change ports in docker-compose.prod.yml
# Or stop conflicting services
```

## ✅ Success Checklist

- [ ] Git identity configured
- [ ] Changes committed and pushed
- [ ] Dependencies installed
- [ ] Docker services running
- [ ] Health check returns 200
- [ ] Metrics endpoint works
- [ ] Grafana dashboard loads
- [ ] All 7 panels show data
- [ ] Screenshots captured

## 📚 More Help

- [Full Setup Guide](SETUP.md)
- [Monitoring README](README.md)
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md)

---

**That's it! You're monitoring! 🎉**
