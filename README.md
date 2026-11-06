# 🚀 Stellar Footprint Service

[![CI](https://github.com/Mossad-esc/stellar-footprint-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Mossad-esc/stellar-footprint-engine/actions/workflows/ci.yml)
[![Docker Publish](https://github.com/Mossad-esc/stellar-footprint-engine/actions/workflows/release.yml/badge.svg)](https://github.com/Mossad-esc/stellar-footprint-engine/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/Mossad-esc/stellar-footprint-engine/branch/main/graph/badge.svg)](https://codecov.io/gh/Mossad-esc/stellar-footprint-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

**Pre-flight Simulation & Developer Experience (DX) for Soroban Smart Contracts**

A backend service that automates the complex footprint extraction process for Stellar/Soroban transactions, acting as a middleman between your frontend and the Stellar RPC network.

---

## 🎯 Why This Exists

One of the biggest hurdles in Soroban development is that you cannot simply "send" a transaction — you must first tell the network exactly which ledger entries you plan to touch (the **Footprint**). This service automates that complex step.

### The Problem

- Every Soroban transaction requires a footprint (read-only and read-write ledger keys)
- Manually calculating footprints is error-prone and tedious
- Frontends would need to bundle massive amounts of simulation logic
- Resource fees depend on accurate footprint optimization

### The Solution

This service centralizes the "pre-flight" heavy lifting:

1. **Simulation** — Calls Stellar's `simulateTransaction` endpoint
2. **Extraction** — Parses results to extract `read_only` and `read_write` footprints
3. **Optimization** — Analyzes simulation to identify unnecessary ledger entries
4. **Cost Estimation** — Returns resource costs (CPU instructions, memory bytes)

**Result:** Frontends send user intent → Service returns optimized footprint → User signs and submits.

---

## 🏗️ Architecture

```mermaid
sequenceDiagram
    participant Client
    participant Service as Footprint Service
    participant Cache as Redis Cache
    participant RPC as Stellar RPC

    Client->>Service: POST /api/simulate { xdr, network }

    Service->>Service: Validate request (XDR present, content-type)
    alt Validation fails
        Service-->>Client: 400 Bad Request
    end

    Service->>Cache: GET cache key (hash of xdr + network)
    alt Cache hit
        Cache-->>Service: Cached result
        Service-->>Client: 200 OK (footprint + cost) [from cache]
    else Cache miss
        Service->>RPC: simulateTransaction(tx)

        alt RPC circuit breaker open
            Service-->>Client: 503 Service Unavailable
        else RPC error
            RPC-->>Service: Simulation error
            Service-->>Client: 422 Unprocessable Entity { error }
        else Restoration required
            RPC-->>Service: RestoreFootprint response
            Service-->>Client: 422 Unprocessable Entity { error: "restoration required" }
        else Success
            RPC-->>Service: Simulation result (footprint + cost)
            Service->>Service: Extract & optimize footprint
            Service->>Cache: SET cache key → result (TTL)
            Service-->>Client: 200 OK { footprint, cost }
        end
    end
```

For a detailed explanation of each component and design decisions, see [docs/architecture.md](./docs/architecture.md).

---

## 📦 Installation

### Quick Start

> **Prerequisites:** Node.js >= 18.0.0. Use [nvm](https://github.com/nvm-sh/nvm) and run `nvm use` to automatically switch to the correct version.

```bash
# Clone the repository
git clone https://github.com/Mossad-esc/stellar-footprint-engine.git
cd stellar-footprint-engine

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your RPC URLs and keys
```

## Load Testing

To benchmark the service under concurrent load:

1. Start the local server:
   ```bash
   npm run dev
   ```
2. Run the autocannon load test:
   ```bash
   npm run load-test
   ```

### Available scenarios

The load test supports two scenarios controlled by the `LOAD_TEST_SCENARIO` environment variable:

- **`health`** (default): Tests the `/health` endpoint
- **`batch`**: Tests the `/api/simulate/batch` endpoint with 5 transactions per request

To run the batch simulation scenario:

```bash
LOAD_TEST_SCENARIO=batch npm run load-test
```

### What is tested

This load test runs three concurrency levels against the service:

- `10` connections
- `50` connections
- `100` connections

**Batch simulation scenario** sends POST requests to `/api/simulate/batch` with 5 Soroban transactions per request, simulating realistic workloads where multiple transactions need footprint extraction.

### Metrics explained

- `p50`: median latency, meaning half of requests completed faster than this value.
- `p95`: latency at the 95th percentile, showing how slow the slowest 5% of requests are.
- `p99`: latency at the 99th percentile, showing the tail latency for the slowest 1% of requests.
- `Req/sec`: average number of successful requests per second.
- `Errors(%)`: percentage of requests that failed, timed out, or returned non-2xx responses.

### How to interpret results

- Lower `p50`, `p95`, and `p99` values indicate better request latency.
- A small gap between `p95` and `p99` suggests a stable service under load.
- A low `Errors(%)` means the service handled the traffic reliably.
- For batch scenarios, multiply `Req/sec` by 5 to get the effective transaction simulation throughput.

### Customize the target

By default, the load test targets the health endpoint at `http://localhost:3000/health`.

You can override the base URL using `LOAD_TEST_URL` or change the path via `LOAD_TEST_PATH` (for health scenario only):

```bash
LOAD_TEST_URL=http://localhost:3000 LOAD_TEST_PATH=/metrics npm run load-test
```

For batch simulation testing:

```bash
LOAD_TEST_URL=http://localhost:3000 LOAD_TEST_SCENARIO=batch npm run load-test
```

### Scaffold from Scratch

If you want to build this project from scratch, here's the complete scaffold:

```bash
# Create project directory
mkdir stellar-footprint-service
cd stellar-footprint-service

# Initialize npm project
npm init -y

# Install dependencies
npm install @stellar/stellar-sdk express dotenv
npm install -D @types/express @types/node ts-node typescript

# Create directory structure
mkdir -p src/api src/services src/config
```

Create the following files:

**`package.json`**

```json
{
  "name": "stellar-footprint-service",
  "version": "1.0.0",
  "description": "Stellar transaction footprint simulation service",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "@stellar/stellar-sdk": "^12.0.0",
    "express": "^4.18.2",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.2"
  }
}
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**`.env`**

```env
# Stellar Network RPC URLs
MAINNET_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>
TESTNET_RPC_URL=https://soroban-testnet.stellar.org

# Secret Keys (never commit real keys)
MAINNET_SECRET_KEY=your_mainnet_secret_key_here
TESTNET_SECRET_KEY=your_testnet_secret_key_here

# App Config
PORT=3000
NETWORK=testnet
```

**`src/config/stellar.ts`**

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

export type Network = "mainnet" | "testnet";

interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  secretKey: string;
}

const configs: Record<Network, NetworkConfig> = {
  mainnet: {
    rpcUrl: process.env.MAINNET_RPC_URL || "",
    networkPassphrase: StellarSdk.Networks.PUBLIC,
    secretKey: process.env.MAINNET_SECRET_KEY || "",
  },
  testnet: {
    rpcUrl:
      process.env.TESTNET_RPC_URL || "https://soroban-testnet.stellar.org",
    networkPassphrase: StellarSdk.Networks.TESTNET,
    secretKey: process.env.TESTNET_SECRET_KEY || "",
  },
};

export function getNetworkConfig(network: Network = "testnet"): NetworkConfig {
  const config = configs[network];
  if (!config.rpcUrl) {
    throw new Error(`RPC URL not configured for network: ${network}`);
  }
  return config;
}

export function getRpcServer(
  network: Network = "testnet",
): StellarSdk.SorobanRpc.Server {
  const { rpcUrl } = getNetworkConfig(network);
  return new StellarSdk.SorobanRpc.Server(rpcUrl, { allowHttp: false });
}
```

**`src/services/simulator.ts`**

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import { Network, getNetworkConfig, getRpcServer } from "../config/stellar";

export interface SimulateResult {
  success: boolean;
  footprint?: {
    readOnly: string[];
    readWrite: string[];
  };
  cost?: {
    cpuInsns: string;
    memBytes: string;
  };
  error?: string;
  raw?: StellarSdk.SorobanRpc.Api.SimulateTransactionResponse;
}
/**
 * Simulates a Stellar transaction and returns footprint data.
 *
 * @param xdr - Base64 encoded transaction XDR
 * @param network - Stellar network type
 * @returns Simulation result containing footprint and cost
 */
export async function simulateTransaction(
  xdr: string,
  network: Network = "testnet",
): Promise<SimulateResult> {
  const server = getRpcServer(network);
  const { networkPassphrase } = getNetworkConfig(network);

  const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  const response = await server.simulateTransaction(tx);

  if (StellarSdk.SorobanRpc.Api.isSimulationError(response)) {
    return { success: false, error: response.error, raw: response };
  }

  if (StellarSdk.SorobanRpc.Api.isSimulationRestore(response)) {
    return {
      success: false,
      error: "Transaction requires ledger entry restoration before simulation.",
      raw: response,
    };
  }

  const footprint = response.transactionData?.build().resources().footprint();

  return {
    success: true,
    footprint: {
      readOnly: footprint?.readOnly().map((e) => e.toXDR("base64")) ?? [],
      readWrite: footprint?.readWrite().map((e) => e.toXDR("base64")) ?? [],
    },
    cost: {
      cpuInsns: response.cost?.cpuInsns ?? "0",
      memBytes: response.cost?.memBytes ?? "0",
    },
    raw: response,
  };
}
```

**`src/api/controllers.ts`**

```typescript
import { Request, Response } from "express";
import { simulateTransaction } from "../services/simulator";
import { Network } from "../config/stellar";

export async function simulate(req: Request, res: Response): Promise<void> {
  const { xdr, network } = req.body as { xdr?: string; network?: Network };

  if (!xdr) {
    res.status(400).json({ error: "Missing required field: xdr" });
    return;
  }

  const net: Network = network === "mainnet" ? "mainnet" : "testnet";

  try {
    const result = await simulateTransaction(xdr, net);
    res.status(result.success ? 200 : 422).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
}
```

**`src/api/routes.ts`**

```typescript
import { Router } from "express";
import { simulate } from "./controllers";

const router = Router();

// POST /simulate — accepts { xdr, network } and returns footprint + cost
router.post("/simulate", simulate);

export default router;
```

**`src/index.ts`**

```typescript
import express from "express";
import dotenv from "dotenv";
import routes from "./api/routes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use("/api", routes);

app.listen(PORT, () => {
  console.log(`stellar-footprint-service running on port ${PORT}`);
});

export default app;
```

**`.gitignore`**

```
node_modules/
dist/
.env
*.log
.DS_Store
```

Now run:

```bash
npm install
npm run dev
```

Your service will be running at `http://localhost:3000`!

---

## ⚙️ Configuration

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

### Getting RPC URLs

- **Testnet (Free):** `https://soroban-testnet.stellar.org`
- **Mainnet:** Get an API key from [Validation Cloud](https://validationcloud.io/) or [Infstones](https://infstones.com/)

---

## 🔧 Environment Variables

| Variable                      | Description                                                                                                                    | Required        | Default                               | Example                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------------------- | --------------------------------------------------------- |
| `NODE_ENV`                    | Runtime environment                                                                                                            | ✅              | —                                     | `production`                                              |
| `PORT`                        | Port the HTTP server listens on                                                                                                | ✅              | `3000`                                | `3000`                                                    |
| `TESTNET_RPC_URL`             | Stellar testnet Soroban RPC endpoint                                                                                           | ✅              | `https://soroban-testnet.stellar.org` | `https://soroban-testnet.stellar.org`                     |
| `MAINNET_RPC_URL`             | Stellar mainnet Soroban RPC endpoint                                                                                           | ⚠️ mainnet only | —                                     | `https://mainnet.stellar.validationcloud.io/v1/<KEY>`     |
| `TESTNET_SECRET_KEY`          | Stellar secret key for testnet signing                                                                                         | ⚠️ if signing   | —                                     | `SXXXXX...`                                               |
| `MAINNET_SECRET_KEY`          | Stellar secret key for mainnet signing                                                                                         | ⚠️ if signing   | —                                     | `SXXXXX...`                                               |
| `NETWORK`                     | Default network when none is specified in request                                                                              | ❌              | `testnet`                             | `mainnet`                                                 |
| `SIMULATE_TIMEOUT_MS`         | Timeout for simulation requests in milliseconds                                                                                | ❌              | `30000`                               | `15000`                                                   |
| `LOG_LEVEL`                   | Logging verbosity (`debug` \| `info` \| `warn` \| `error`)                                                                     | ❌              | `info`                                | `debug`                                                   |
| `COMPRESSION_THRESHOLD`       | Minimum response size in bytes before gzip compression is applied                                                              | ❌              | `1024`                                | `512`                                                     |
| `RPC_POOL_TTL_MS`             | How long an RPC server connection is reused before being recreated (ms)                                                        | ❌              | `300000`                              | `60000`                                                   |
| `IP_ALLOWLIST`                | Comma-separated list of allowed IPs/CIDRs. If set, all other IPs are blocked                                                   | ❌              | —                                     | `192.168.1.0/24,10.0.0.1`                                 |
| `IP_BLOCKLIST`                | Comma-separated list of blocked IPs/CIDRs                                                                                      | ❌              | —                                     | `1.2.3.4,5.6.7.0/24`                                      |
| `BRUTE_FORCE_DELAY_THRESHOLD` | Number of requests from one IP before responses are delayed                                                                    | ❌              | `10`                                  | `5`                                                       |
| `BRUTE_FORCE_BLOCK_THRESHOLD` | Number of requests from one IP before the IP is blocked                                                                        | ❌              | `20`                                  | `15`                                                      |
| `BRUTE_FORCE_WINDOW_MS`       | Rolling time window for brute-force counting (ms)                                                                              | ❌              | `60000`                               | `30000`                                                   |
| `BRUTE_FORCE_DELAY_MS`        | Delay added to responses once delay threshold is hit (ms)                                                                      | ❌              | `5000`                                | `2000`                                                    |
| `BRUTE_FORCE_BLOCK_MS`        | Duration an IP remains blocked (ms)                                                                                            | ❌              | `300000`                              | `600000`                                                  |
| `CB_FAILURE_THRESHOLD`        | Number of RPC failures before the circuit breaker opens                                                                        | ❌              | `5`                                   | `3`                                                       |
| `CB_RECOVERY_MS`              | Time the circuit breaker waits before attempting recovery (ms)                                                                 | ❌              | `30000`                               | `15000`                                                   |
| `BATCH_MAX_SIZE`              | Maximum number of transactions allowed in a single batch simulate request                                                      | ❌              | `10`                                  | `5`                                                       |
| `GRAFANA_USER`                | Grafana admin username (Docker Compose only)                                                                                   | ❌              | `admin`                               | `admin`                                                   |
| `GRAFANA_PASSWORD`            | Grafana admin password (Docker Compose only)                                                                                   | ❌              | `admin`                               | `s3cur3pass`                                              |
| `REDIS_URL`                   | Redis connection URL. When set, enables the Redis cache backend; falls back to in-memory LRU if unset or on connection failure | ❌              | —                                     | `redis://localhost:6379` / `rediss://user:pass@host:6380` |

> ⚠️ = conditionally required. Never commit real secret keys — use your platform's secrets manager in production.

---

## 🚀 Usage

### Development Mode

```bash
npm run dev
npm run dev:watch
```

`npm run dev:watch` uses `nodemon` and the project's `nodemon.json` configuration to restart automatically on `src/**/*.ts` changes.

### Production Build

```bash
npm run build
npm start
```

The service will start on `http://localhost:3000` (or your configured `PORT`).

### Clean Build Artifacts

```bash
npm run clean          # Remove dist/ and coverage/
npm run build:clean    # Clean then rebuild from source
```

---

## 📡 API Reference

You can also test the API using the [Postman collection](./docs/postman/stellar-footprint-service.postman_collection.json). Import this collection into Postman to get started quickly.

You can also test the API using the [Postman collection](./docs/postman/stellar-footprint-service.postman_collection.json). Import this collection into Postman to get started quickly.

### `POST /api/simulate`

Simulate a Soroban transaction and extract its footprint.

#### Request Body

```json
{
  "xdr": "AAAAAgAAAAC...",
  "network": "testnet",
  "ledgerSequence": 12345678
}
```

| Field            | Type   | Required | Description                                                                                                       |
| ---------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `xdr`            | string | ✅       | Base64-encoded transaction XDR                                                                                    |
| `network`        | string | ❌       | `"testnet"`, `"mainnet"`, or `"futurenet"` (default: `"testnet"`)                                                 |
| `ledgerSequence` | number | ❌       | Specific ledger sequence to simulate against. Useful for reproducing historical simulation results and debugging. |

#### Success Response (200)

```json
{
  "success": true,
  "footprint": {
    "readOnly": ["AAAABgAAAAHZ...", "AAAABgAAAAHa..."],
    "readWrite": ["AAAABgAAAAHb..."]
  },
  "cost": {
    "cpuInsns": "1234567",
    "memBytes": "8192"
  }
}
```

#### Error Response (422)

```json
{
  "success": false,
  "error": "Transaction requires ledger entry restoration before simulation."
}
```

#### Error Response (400)

```json
{
  "error": "Missing required field: xdr"
}
```

---

## 🧪 Example Usage

### Using `curl`

```bash
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "xdr": "AAAAAgAAAADZ1Q...",
    "network": "testnet"
  }'
```

### Using JavaScript (Frontend)

```javascript
async function simulateVote(transactionXdr) {
  const response = await fetch("http://localhost:3000/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      xdr: transactionXdr,
      network: "testnet",
    }),
  });

  const result = await response.json();

  if (result.success) {
    console.log("Footprint:", result.footprint);
    console.log("Estimated cost:", result.cost);
    // Use footprint to assemble final transaction
  } else {
    console.error("Simulation failed:", result.error);
  }
}
```

### Using Python

```python
import requests

response = requests.post('http://localhost:3000/api/simulate', json={
    'xdr': 'AAAAAgAAAADZ1Q...',
    'network': 'testnet'
})

data = response.json()
if data['success']:
    print(f"Read-only entries: {len(data['footprint']['readOnly'])}")
    print(f"Read-write entries: {len(data['footprint']['readWrite'])}")
```

---

## 🛠️ Project Structure

```
stellar-footprint-service/
├── src/
│   ├── api/
│   │   ├── routes.ts           # REST endpoint definitions
│   │   └── controllers.ts      # Request handling logic
│   ├── services/
│   │   └── simulator.ts        # Stellar SDK integration
│   ├── config/
│   │   └── stellar.ts          # Network configurations
│   └── index.ts                # App entry point
├── package.json
├── tsconfig.json
├── .env                        # Environment variables (not committed)
├── .gitignore
├── ISSUES.md                   # 150+ improvement ideas
└── README.md
```

### File Breakdown

#### `src/index.ts` — Entry Point

The main application file that bootstraps Express and registers routes.

```typescript
import express from "express";
import dotenv from "dotenv";
import routes from "./api/routes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use("/api", routes);

app.listen(PORT, () => {
  console.log(`stellar-footprint-service running on port ${PORT}`);
});

export default app;
```

#### `src/config/stellar.ts` — Network Configuration

Manages Stellar network settings (Mainnet/Testnet) and RPC server initialization.

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

export type Network = "mainnet" | "testnet";

interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  secretKey: string;
}

const configs: Record<Network, NetworkConfig> = {
  mainnet: {
    rpcUrl: process.env.MAINNET_RPC_URL || "",
    networkPassphrase: StellarSdk.Networks.PUBLIC,
    secretKey: process.env.MAINNET_SECRET_KEY || "",
  },
  testnet: {
    rpcUrl:
      process.env.TESTNET_RPC_URL || "https://soroban-testnet.stellar.org",
    networkPassphrase: StellarSdk.Networks.TESTNET,
    secretKey: process.env.TESTNET_SECRET_KEY || "",
  },
};

export function getNetworkConfig(network: Network = "testnet"): NetworkConfig {
  const config = configs[network];
  if (!config.rpcUrl) {
    throw new Error(`RPC URL not configured for network: ${network}`);
  }
  return config;
}

export function getRpcServer(
  network: Network = "testnet",
): StellarSdk.SorobanRpc.Server {
  const { rpcUrl } = getNetworkConfig(network);
  return new StellarSdk.SorobanRpc.Server(rpcUrl, { allowHttp: false });
}
```

#### `src/services/simulator.ts` — Core Simulation Logic

Integrates with Stellar SDK to simulate transactions and extract footprints.

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import { Network, getNetworkConfig, getRpcServer } from "../config/stellar";

export interface SimulateResult {
  success: boolean;
  footprint?: {
    readOnly: string[];
    readWrite: string[];
  };
  cost?: {
    cpuInsns: string;
    memBytes: string;
  };
  error?: string;
  raw?: StellarSdk.SorobanRpc.Api.SimulateTransactionResponse;
}

export async function simulateTransaction(
  xdr: string,
  network: Network = "testnet",
): Promise<SimulateResult> {
  const server = getRpcServer(network);
  const { networkPassphrase } = getNetworkConfig(network);

  // Parse XDR into transaction object
  const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);

  // Call Stellar RPC simulateTransaction endpoint
  const response = await server.simulateTransaction(tx);

  // Handle simulation errors
  if (StellarSdk.SorobanRpc.Api.isSimulationError(response)) {
    return { success: false, error: response.error, raw: response };
  }

  // Handle restoration requirement
  if (StellarSdk.SorobanRpc.Api.isSimulationRestore(response)) {
    return {
      success: false,
      error: "Transaction requires ledger entry restoration before simulation.",
      raw: response,
    };
  }

  // Extract footprint from simulation response
  const footprint = response.transactionData?.build().resources().footprint();

  return {
    success: true,
    footprint: {
      readOnly: footprint?.readOnly().map((e) => e.toXDR("base64")) ?? [],
      readWrite: footprint?.readWrite().map((e) => e.toXDR("base64")) ?? [],
    },
    cost: {
      cpuInsns: response.cost?.cpuInsns ?? "0",
      memBytes: response.cost?.memBytes ?? "0",
    },
    raw: response,
  };
}
```

#### `src/api/controllers.ts` — Request Handlers

Processes incoming HTTP requests and returns simulation results.

```typescript
import { Request, Response } from "express";
import { simulateTransaction } from "../services/simulator";
import { Network } from "../config/stellar";

export async function simulate(req: Request, res: Response): Promise<void> {
  const { xdr, network } = req.body as { xdr?: string; network?: Network };

  // Validate required fields
  if (!xdr) {
    res.status(400).json({ error: "Missing required field: xdr" });
    return;
  }

  // Default to testnet if not specified
  const net: Network = network === "mainnet" ? "mainnet" : "testnet";

  try {
    const result = await simulateTransaction(xdr, net);
    res.status(result.success ? 200 : 422).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: message });
  }
}
```

#### `src/api/routes.ts` — API Endpoints

Defines REST API routes and maps them to controllers.

```typescript
import { Router } from "express";
import { simulate } from "./controllers";

const router = Router();

// POST /simulate — accepts { xdr, network } and returns footprint + cost
router.post("/simulate", simulate);

export default router;
```

---

## 🔍 Understanding Footprints

For a beginner-friendly guide explaining what Soroban footprints are, why they are required, and how this service simplifies the process, see [Understanding Soroban Footprints](./docs/guides/understanding-footprints.md).

## 🗄️ Caching Guide

For details on the Redis vs in-memory dual-backend strategy, TTL configuration, cache key structure, and when to use `DELETE /cache`, see [docs/guides/caching.md](./docs/guides/caching.md).

## ⚠️ Error Handling Guide

For a full reference of error codes, HTTP status codes, response shapes, and retry recommendations, see [docs/guides/error-handling.md](./docs/guides/error-handling.md).

## 📊 Monitoring Guide

For production monitoring setup (Prometheus + Grafana), available metrics, dashboard import, and alerting recommendations, see [docs/guides/monitoring.md](./docs/guides/monitoring.md).

## 🧩 Integration Guide

### Step 1: Build Transaction

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

const contract = new StellarSdk.Contract("CONTRACT_ID");
const tx = new StellarSdk.TransactionBuilder(account, { fee: "100" })
  .addOperation(contract.call("vote", ...args))
  .setTimeout(30)
  .build();

const xdr = tx.toXDR();
```

### Step 2: Simulate via Service

```typescript
const response = await fetch("http://localhost:3000/api/simulate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ xdr, network: "testnet" }),
});

const { footprint, cost } = await response.json();
```

### Step 3: Assemble Final Transaction

```typescript
// Use footprint to build SorobanDataBuilder
const sorobanData = new StellarSdk.SorobanDataBuilder()
  .setFootprint(footprint.readOnly, footprint.readWrite)
  .build();

// Rebuild transaction with footprint
const finalTx = StellarSdk.TransactionBuilder.cloneFrom(tx, {
  sorobanData,
  fee: calculateFee(cost),
}).build();

// User signs and submits
finalTx.sign(keypair);
await server.sendTransaction(finalTx);
```

---

## 🔐 Security Considerations

- **Never commit `.env`** — Add it to `.gitignore`
- **Rotate secret keys** regularly
- **Use HTTPS** in production
- **Validate XDR inputs** to prevent injection attacks
- **Rate limit** the `/api/simulate` endpoint
- **Sanitize errors** to avoid leaking internal details

To report a security vulnerability, please follow our [Security Policy](./SECURITY.md). Do not open a public issue.

---

## 🐛 Troubleshooting

### "RPC URL not configured for network"

**Solution:** Ensure your `.env` file has `TESTNET_RPC_URL` or `MAINNET_RPC_URL` set.

### "Transaction requires ledger entry restoration"

**Solution:** Some ledger entries have expired. You need to submit a restoration transaction first before simulating.

### Simulation returns empty footprint

**Solution:** Verify your transaction XDR is valid and targets a deployed Soroban contract.

### Port already in use

**Solution:** Change `PORT` in `.env` or kill the process using `lsof -ti:3000 | xargs kill`.

---

## 📊 Performance Tips

- **Cache simulations** for identical XDRs (see [#28](ISSUES.md))
- **Batch requests** if simulating multiple transactions (see [#22](ISSUES.md))
- **Use connection pooling** for RPC calls
- **Monitor RPC latency** and switch providers if needed
- **Gzip compression** is enabled automatically for responses larger than `COMPRESSION_THRESHOLD` bytes (default: `1024`). Clients must send `Accept-Encoding: gzip`. Tune the threshold via the `COMPRESSION_THRESHOLD` environment variable — lower values compress more aggressively, higher values reduce CPU overhead for small payloads.

---

## 📋 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a full history of changes.

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide covering fork/clone setup, local development, code style, commit format, PR process, and issue labels.

Check out [ISSUES.md](ISSUES.md) for 150+ ideas on where to start.

---

## 🚢 Deployment

Step-by-step guides for deploying to common platforms:

| Platform       | Guide                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| Railway        | [docs/deployment.md#1-railway](./docs/deployment.md#1-railway)                     |
| Render         | [docs/deployment.md#2-render](./docs/deployment.md#2-render)                       |
| Fly.io         | [docs/deployment.md#3-flyio](./docs/deployment.md#3-flyio)                         |
| Bare VPS + PM2 | [docs/deployment.md#4-bare-vps-with-pm2](./docs/deployment.md#4-bare-vps-with-pm2) |
| Kubernetes     | [docs/guides/kubernetes.md](./docs/guides/kubernetes.md)                           |

See the full [Deployment Guide](./docs/deployment.md) for environment variable reference and health check configuration.

---

## 📝 Roadmap

- [ ] Add batch simulation endpoint
- [ ] Implement response caching with Redis
- [ ] Add Prometheus metrics
- [x] Support Futurenet
- [ ] Build OpenAPI/Swagger docs
- [x] Add deployment guide

See [ISSUES.md](ISSUES.md) for the full list.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🌟 Acknowledgments

- Built with [Stellar SDK](https://github.com/stellar/js-stellar-sdk)
- Powered by [Soroban RPC](https://soroban.stellar.org/)
- Inspired by the need for better Soroban DX

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/Mossad-esc/stellar-footprint-engine/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Mossad-esc/stellar-footprint-engine/discussions)
- **Stellar Discord:** [stellar.org/community](https://stellar.org/community)

---

**Made with ❤️ for the Stellar/Soroban community**
