# TypeScript Integration Example

This example demonstrates using the official `@stellar-footprint/sdk` TypeScript/JavaScript client library to simulate transactions, estimate fees, compare footprints, and decode XDR payloads.

## Prerequisites

- Node.js 18+ installed
- `@stellar-footprint/sdk` installed (`pnpm add @stellar-footprint/sdk`)
- The Stellar Footprint Service running (default: `http://localhost:3000`)

## Installation

```bash
pnpm add @stellar-footprint/sdk
```

## Code

```typescript
import {
  StellarFootprintClient,
  StellarFootprintError,
} from "@stellar-footprint/sdk";

const client = new StellarFootprintClient({
  baseURL: "http://localhost:3000/api/v1",
  timeout: 15_000,
  retries: 2,
  apiKey: process.env.FOOTPRINT_API_KEY, // optional
});

const SAMPLE_TX_XDR =
  "AAAAAgAAAACnDQTKOBdaOH0ynf6k7SpkytahlUjNsWgm4WEB8rmE1QAAAGQAAAAAAAAAZwAAAAEAAAAAAAAAAAAAAABp6joKAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFaGVsbG8AAAAAAAABAAAAAQAAAAAAAAAAAAAAAfK5hNUAAABAIbPVF4x6vSLx/J3T0SDhvTNtytA/BNO+qMJ74p/b3Y8xpBhR7xzy68FuEyffaF9fNXHEC+77WK+oOJpfon1tCg==";

async function main() {
  try {
    // 1. Decode XDR locally via API
    const decoded = await client.decode(SAMPLE_TX_XDR, "transaction");
    console.log("Decoded transaction:", decoded.success);

    // 2. Simulate a single transaction
    const simulation = await client.simulate(SAMPLE_TX_XDR, {
      network: "testnet",
    });
    console.log("Simulation success:", simulation.success);
    console.log("Footprint stats:", simulation.footprintStats);

    // 3. Estimate fees using simulated cost
    if (simulation.cost) {
      const fee = await client.estimateFee(SAMPLE_TX_XDR, {
        cpuInsns: simulation.cost.cpuInsns,
        memBytes: simulation.cost.memBytes,
        network: "testnet",
      });
      console.log("Estimated total fee (XLM):", fee.feeInXLM);
    }

    // 4. Batch simulate multiple transactions
    const batch = await client.simulateBatch([SAMPLE_TX_XDR], {
      network: "testnet",
    });
    console.log("Batch results:", batch.results.length);

    // 5. Diff two footprints
    const diff = await client.diffFootprints(
      { readOnly: [], readWrite: [] },
      simulation.rawFootprint ?? { readOnly: [], readWrite: [] },
    );
    console.log("Added footprint entries:", diff.added);
  } catch (err) {
    if (err instanceof StellarFootprintError) {
      console.error(`SDK Error [${err.code ?? err.status}]:`, err.message);
    } else {
      console.error("Unexpected error:", err);
    }
  }
}

main();
```

## Error Handling

All failed requests throw a typed `StellarFootprintError` containing `status`, `code`, and `details` from the API response envelope. Transient `429` and `5xx` responses as well as network errors are automatically retried with exponential backoff according to the `retries` configuration.
