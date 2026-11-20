#!/usr/bin/env node
"use strict";

/**
 * Manifest of environment variables used by this service.
 *
 * required: true  - service will not operate correctly without this variable
 * required: false - optional; the service has a sensible default or the
 *                   variable is only needed in specific configurations
 * group: string   - variables in the same group satisfy a "at least one"
 *                   constraint rather than an individual required check
 */
const MANIFEST = [
  {
    name: "NODE_ENV",
    description: "Runtime environment: development | staging | production",
    required: true,
  },
  {
    name: "TESTNET_RPC_URL",
    description: "Stellar testnet Soroban RPC endpoint",
    required: false,
    group: "rpc",
  },
  {
    name: "MAINNET_RPC_URL",
    description: "Stellar mainnet Soroban RPC endpoint",
    required: false,
    group: "rpc",
  },
  {
    name: "FUTURENET_RPC_URL",
    description: "Stellar futurenet Soroban RPC endpoint",
    required: false,
    group: "rpc",
  },
  {
    name: "PORT",
    description: "HTTP port to listen on (default: 3000)",
    required: false,
  },
  {
    name: "TESTNET_SECRET_KEY",
    description: "Stellar secret key for testnet signing",
    required: false,
  },
  {
    name: "MAINNET_SECRET_KEY",
    description: "Stellar secret key for mainnet signing",
    required: false,
  },
  {
    name: "FUTURENET_SECRET_KEY",
    description: "Stellar secret key for futurenet signing",
    required: false,
  },
  {
    name: "REDIS_URL",
    description: "Redis connection URL for distributed caching (optional)",
    required: false,
  },
  {
    name: "SIMULATE_TIMEOUT_MS",
    description: "Simulation request timeout in ms (default: 30000)",
    required: false,
  },
  {
    name: "CACHE_TTL_SECONDS",
    description: "Cache time-to-live in seconds (default: 60)",
    required: false,
  },
  {
    name: "CACHE_MAX_SIZE",
    description: "Maximum LRU cache entries (default: 500)",
    required: false,
  },
  {
    name: "LOG_LEVEL",
    description:
      "Logging verbosity: debug | info | warn | error (default: info)",
    required: false,
  },
  {
    name: "CB_FAILURE_THRESHOLD",
    description: "RPC failures before circuit breaker opens (default: 5)",
    required: false,
  },
  {
    name: "CB_RECOVERY_MS",
    description: "Circuit breaker recovery wait time in ms (default: 30000)",
    required: false,
  },
  {
    name: "RATE_LIMIT_MAX",
    description: "Max requests per window per IP (default: 60)",
    required: false,
  },
  {
    name: "RATE_LIMIT_WINDOW_MS",
    description: "Rate-limit rolling window in ms (default: 60000)",
    required: false,
  },
  {
    name: "CORS_ORIGIN",
    description: "Allowed CORS origin (default: all origins)",
    required: false,
  },
  {
    name: "IP_ALLOWLIST",
    description:
      "Comma-separated IPs/CIDRs to allow (blocks all others when set)",
    required: false,
  },
  {
    name: "IP_BLOCKLIST",
    description: "Comma-separated IPs/CIDRs to block (alias: IP_DENYLIST)",
    required: false,
  },
  {
    name: "TRUSTED_PROXY_COUNT",
    description:
      "Number of trusted reverse proxies for X-Forwarded-For parsing (default: 0)",
    required: false,
  },
];

// Load .env if present (best-effort — dotenv may not be installed yet)
try {
  require("dotenv").config();
} catch {
  // dotenv is a dev dependency; skip in environments where it is not installed
}

const COL_VAR = 30;
const COL_STATUS = 10;
const COL_DESC = 52;

function pad(str, len) {
  return String(str).slice(0, len).padEnd(len);
}

function printTable(rows) {
  const divider = "-".repeat(COL_VAR + COL_STATUS + COL_DESC + 6);
  const header =
    "| " +
    pad("VARIABLE", COL_VAR) +
    " | " +
    pad("STATUS", COL_STATUS) +
    " | " +
    pad("DESCRIPTION", COL_DESC) +
    " |";

  console.log(divider);
  console.log(header);
  console.log(divider);

  for (const row of rows) {
    console.log(
      "| " +
        pad(row.name, COL_VAR) +
        " | " +
        pad(row.status, COL_STATUS) +
        " | " +
        pad(row.description, COL_DESC) +
        " |",
    );
  }

  console.log(divider);
}

function check() {
  const rows = [];
  const missing = [];

  // Group constraint: at least one var in the same group must be set
  const groupPresent = {};
  for (const entry of MANIFEST) {
    if (entry.group && process.env[entry.name]) {
      groupPresent[entry.group] = true;
    }
  }

  for (const entry of MANIFEST) {
    const value = process.env[entry.name];
    const isPresent = value !== undefined && value !== "";

    let status;
    let isMissing = false;

    if (isPresent) {
      status = "present";
    } else if (entry.required) {
      status = "MISSING";
      isMissing = true;
    } else if (entry.group && !groupPresent[entry.group]) {
      // Flag only the first var in the group to avoid duplicate errors
      const isFirst =
        MANIFEST.findIndex((m) => m.group === entry.group) ===
        MANIFEST.indexOf(entry);
      if (isFirst) {
        status = "MISSING(*)";
        isMissing = true;
      } else {
        status = "optional";
      }
    } else {
      status = "optional";
    }

    if (isMissing) missing.push(entry);

    rows.push({ name: entry.name, status, description: entry.description });
  }

  console.log("\nEnvironment variable check\n");
  printTable(rows);

  if (groupPresent["rpc"] === undefined) {
    console.log(
      "\n(*) At least one RPC URL (TESTNET_RPC_URL, MAINNET_RPC_URL, or FUTURENET_RPC_URL) must be set.\n",
    );
  }

  if (missing.length > 0) {
    console.error(
      `\nError: ${missing.length} required variable(s) not set: ${missing.map((m) => m.name).join(", ")}\n`,
    );
    console.error(
      "Copy .env.example to .env and fill in the missing values.\n",
    );
    process.exit(1);
  }

  console.log("\nAll required environment variables are set.\n");
}

check();
