# @stellar-footprint/sdk

Official zero-dependency TypeScript/JavaScript client SDK for the **Stellar Footprint Engine** API. Designed for React, Vue, Next.js, and Node.js dApps.

## Installation

```bash
npm install @stellar-footprint/sdk
# or
pnpm add @stellar-footprint/sdk
```

## Quick Start

```typescript
import { StellarFootprintClient } from "@stellar-footprint/sdk";

const client = new StellarFootprintClient({
  baseURL: "http://localhost:3000/api/v1",
  timeout: 15000,
  retries: 2,
  apiKey: process.env.FOOTPRINT_API_KEY, // optional
});

const sim = await client.simulate(txXdr, { network: "testnet" });
console.log(sim.footprintStats, sim.cost);
```

## API

- `simulate(xdr, options?)` — Simulate a Soroban transaction XDR.
- `simulateBatch(xdrs, options?)` — Simulate multiple transactions in one call.
- `estimateFee(xdr, options?)` — Estimate Soroban resource and inclusion fees.
- `diffFootprints(xdrA, xdrB, options?)` — Compare two footprints or transaction XDRs.
- `decode(xdr, type?)` — Decode a base64 XDR (`transaction`, `operation`, `ledger_key`, `auth_entry`).
