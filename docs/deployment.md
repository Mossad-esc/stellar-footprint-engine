# Deployment Guide

Step-by-step deployment instructions for **Stellar Footprint Service** across common platforms.

---

## Table of Contents

- [Environment Variables Reference](#environment-variables-reference)
- [Railway](#1-railway)
- [Render](#2-render)
- [Fly.io](#3-flyio)
- [Bare VPS with PM2](#4-bare-vps-with-pm2)
- [Kubernetes](#5-kubernetes)

---

## Environment Variables Reference

All platforms require these variables. Copy `.env.example` as a starting point.

| Variable                | Required | Description                                               |
| ----------------------- | -------- | --------------------------------------------------------- |
| `NODE_ENV`              | ✅       | Set to `production`                                       |
| `PORT`                  | ✅       | Port the service listens on (default: `3000`)             |
| `TESTNET_RPC_URL`       | ✅       | Stellar testnet RPC endpoint                              |
| `MAINNET_RPC_URL`       | ⚠️       | Required for mainnet usage                                |
| `TESTNET_SECRET_KEY`    | ⚠️       | Stellar testnet signing key                               |
| `MAINNET_SECRET_KEY`    | ⚠️       | Stellar mainnet signing key                               |
| `SIMULATE_TIMEOUT_MS`   | ❌       | Simulation timeout in ms (default: `30000`)               |
| `LOG_LEVEL`             | ❌       | `debug` \| `info` \| `warn` \| `error` (default: `info`)  |
| `COMPRESSION_THRESHOLD` | ❌       | Response compression threshold in bytes (default: `1024`) |
| `RPC_POOL_TTL_MS`       | ❌       | RPC connection pool TTL in ms (default: `300000`)         |

> **Never commit real secret keys.** Use each platform's secret/environment variable manager.

---

## 1. Railway

Railway auto-detects Node.js projects and builds from your `Dockerfile`.

### Prerequisites

- A [Railway account](https://railway.app)
- Your repo pushed to GitHub

### Steps

1. Go to [railway.app](https://railway.app) and click **New Project**.

2. Select **Deploy from GitHub repo** and authorize Railway to access your repository.

3. Choose the `stellar-footprint-engine` repository. Railway will detect the `Dockerfile` automatically.

4. Once the project is created, click the service card, then go to **Variables**.

5. Add the following environment variables:

   ```
   NODE_ENV=production
   PORT=3000
   TESTNET_RPC_URL=https://soroban-testnet.stellar.org
   MAINNET_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>
   TESTNET_SECRET_KEY=<your_testnet_secret_key>
   MAINNET_SECRET_KEY=<your_mainnet_secret_key>
   LOG_LEVEL=info
   SIMULATE_TIMEOUT_MS=30000
   ```

6. Railway will trigger a redeploy automatically after saving variables.

7. Go to **Settings → Networking** and click **Generate Domain** to get a public URL.

8. Verify the deployment:

   ```bash
   curl https://<your-railway-domain>/health
   ```

   Expected response:

   ```json
   { "status": "healthy", "uptime": 12.3, ... }
   ```

### Health Check

Railway uses the `HEALTHCHECK` instruction in the `Dockerfile` automatically. No additional configuration needed.

---

## 2. Render

Render supports Docker-based deployments with zero-downtime deploys.

### Prerequisites

- A [Render account](https://render.com)
- Your repo pushed to GitHub or GitLab

### Steps

1. Log in to [render.com](https://render.com) and click **New → Web Service**.

2. Connect your GitHub/GitLab account and select the `stellar-footprint-engine` repository.

3. Configure the service:
   - **Name:** `stellar-footprint-service`
   - **Region:** Choose closest to your users
   - **Branch:** `main`
   - **Runtime:** Select **Docker** (Render detects the `Dockerfile`)
   - **Instance Type:** `Starter` (or higher for production)

4. Scroll to **Environment Variables** and add:

   ```
   NODE_ENV=production
   PORT=10000
   TESTNET_RPC_URL=https://soroban-testnet.stellar.org
   MAINNET_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>
   TESTNET_SECRET_KEY=<your_testnet_secret_key>
   MAINNET_SECRET_KEY=<your_mainnet_secret_key>
   LOG_LEVEL=info
   SIMULATE_TIMEOUT_MS=30000
   ```

   > Render assigns port `10000` by default. Set `PORT=10000` to match.

5. Under **Health & Alerts**, set the health check path to `/health`.

6. Click **Create Web Service**. Render will build and deploy from the `Dockerfile`.

7. Once deployed, verify:

   ```bash
   curl https://<your-render-service>.onrender.com/health
   ```

### Auto-Deploy

Render automatically redeploys on every push to the configured branch. Disable this under **Settings → Auto-Deploy** if you prefer manual deploys.

---

## 3. Fly.io

Fly.io runs your Docker container close to users across multiple regions.

### Prerequisites

- A [Fly.io account](https://fly.io)
- `flyctl` CLI installed:
  ```bash
  curl -L https://fly.io/install.sh | sh
  ```

### Steps

1. Authenticate with Fly:

   ```bash
   fly auth login
   ```

2. From the project root, launch the app (do **not** deploy yet when prompted):

   ```bash
   fly launch --no-deploy
   ```

   When prompted:
   - **App name:** `stellar-footprint-service` (or any unique name)
   - **Region:** Choose your preferred region
   - **Postgres / Redis:** Select `No` for both (unless you need caching)

   This creates a `fly.toml` in the project root.

3. Open `fly.toml` and verify/update the `[http_service]` section:

   ```toml
   [http_service]
     internal_port = 3000
     force_https = true
     auto_stop_machines = true
     auto_start_machines = true
     min_machines_running = 1

   [[http_service.checks]]
     grace_period = "10s"
     interval = "30s"
     method = "GET"
     path = "/health"
     timeout = "5s"
   ```

4. Set secrets (environment variables) — these are encrypted at rest:

   ```bash
   fly secrets set NODE_ENV=production
   fly secrets set PORT=3000
   fly secrets set TESTNET_RPC_URL=https://soroban-testnet.stellar.org
   fly secrets set MAINNET_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>
   fly secrets set TESTNET_SECRET_KEY=<your_testnet_secret_key>
   fly secrets set MAINNET_SECRET_KEY=<your_mainnet_secret_key>
   fly secrets set LOG_LEVEL=info
   fly secrets set SIMULATE_TIMEOUT_MS=30000
   ```

5. Deploy:

   ```bash
   fly deploy
   ```

6. Verify the deployment:

   ```bash
   fly status
   curl https://<your-app-name>.fly.dev/health
   ```

7. View live logs:

   ```bash
   fly logs
   ```

### Scaling

To run multiple instances across regions:

```bash
fly scale count 2
fly regions add lhr sin  # add London and Singapore
```

---

## 4. Bare VPS with PM2

Deploy directly on a Linux VPS (Ubuntu/Debian) using PM2 for process management.

### Prerequisites

- A VPS with Ubuntu 22.04+ (DigitalOcean, Hetzner, Linode, etc.)
- SSH access to the server
- A domain name pointed at the server's IP (optional but recommended)

### Steps

#### 1. Connect to your server

```bash
ssh root@<your-server-ip>
```

#### 2. Install Node.js 22 and pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm pm2
```

#### 3. Clone the repository

```bash
git clone https://github.com/Mossad-esc/stellar-footprint-engine.git /opt/stellar-footprint-service
cd /opt/stellar-footprint-service
```

#### 4. Install dependencies and build

```bash
pnpm install --frozen-lockfile --prod=false
pnpm run build
```

#### 5. Configure environment variables

```bash
cp .env.example .env
nano .env
```

Set the following in `.env`:

```env
NODE_ENV=production
PORT=3000
TESTNET_RPC_URL=https://soroban-testnet.stellar.org
MAINNET_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>
TESTNET_SECRET_KEY=<your_testnet_secret_key>
MAINNET_SECRET_KEY=<your_mainnet_secret_key>
LOG_LEVEL=info
SIMULATE_TIMEOUT_MS=30000
# Use TLS for Redis in production when available.
# For a managed Redis instance, use a rediss:// URL.
# REDIS_URL=rediss://redis:6379
```

#### 6. Create the logs directory

```bash
mkdir -p logs
```

#### 7. Start with PM2

```bash
pm2 start ecosystem.config.js --env production
```

> The `ecosystem.config.js` file is configured with `instances: "max"` and `exec_mode: "cluster"` so PM2 will distribute worker processes across available CPU cores. The application also handles `SIGTERM`/`SIGINT` gracefully, which allows clustered workers to shut down cleanly.

#### 8. Save PM2 process list and enable startup on reboot

```bash
pm2 save
pm2 startup
# Run the command that pm2 startup outputs
```

#### 9. Verify the service is running

```bash
pm2 status
curl http://localhost:3000/health
```

Expected output:

```json
{ "status": "healthy", "uptime": 5.2, ... }
```

### PM2 Management Commands

```bash
pm2 status                          # View running processes
pm2 logs stellar-footprint-service  # Tail logs
pm2 restart stellar-footprint-service
pm2 stop stellar-footprint-service
pm2 delete stellar-footprint-service
```

### Log Rotation (recommended)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
```

### Nginx Reverse Proxy (recommended)

If you want to serve on port 80/443 with TLS:

1. Install Nginx and Certbot:

   ```bash
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```

2. Create an Nginx site config at `/etc/nginx/sites-available/stellar-footprint-service`:

   ```nginx
   server {
       listen 80;
       server_name <your-domain.com>;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

3. To protect the `/api/v1/simulate` endpoint from abusive request bursts, add a rate limit rule in your Nginx config:

   ```nginx
   http {
     limit_req_zone $binary_remote_addr zone=simulate_req:10m rate=10r/s;
   }

   server {
     # ...
     error_page 429 = @too_many_requests;

     location = /api/v1/simulate {
       limit_req zone=simulate_req burst=10 nodelay;
       proxy_pass http://localhost:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }

     location @too_many_requests {
       internal;
       add_header Content-Type application/json;
       return 429 '{"error":"Too many requests"}';
     }
   }
   ```

   This ensures the service returns `429` with a JSON error body when rate limiting is exceeded.

3. Enable the site and obtain a TLS certificate:

   ```bash
   sudo ln -s /etc/nginx/sites-available/stellar-footprint-service /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   sudo certbot --nginx -d <your-domain.com>
   ```

4. Verify HTTPS:

   ```bash
   curl https://<your-domain.com>/health
   ```

### Updating the Service

```bash
cd /opt/stellar-footprint-service
git pull origin main
pnpm install --frozen-lockfile --prod=false
pnpm run build
pm2 restart stellar-footprint-service
```

---

## Verifying Any Deployment

After deploying on any platform, run this quick smoke test:

```bash
# Health check
curl https://<your-host>/health

# Simulate endpoint (replace XDR with a real value for full test)
curl -X POST https://<your-host>/api/v1/simulate \
  -H "Content-Type: application/json" \
  -d '{"xdr": "AAAAAgAAAAC...", "network": "testnet"}'
```

A `200` from `/health` and a `400` (missing XDR) or `422` from `/api/v1/simulate` both confirm the service is live and routing correctly.

---

## 5. Kubernetes

For deploying to a Kubernetes cluster using the manifests in `k8s/`, see the full [Kubernetes Deployment Guide](./guides/kubernetes.md).

It covers prerequisites, applying manifests, configuring secrets, HPA tuning, and health check configuration.
