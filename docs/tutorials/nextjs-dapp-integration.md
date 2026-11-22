# Step-by-Step Tutorial: Integrating Footprint Engine in React / Next.js

This tutorial walks through building a complete, production-ready Soroban dApp integration in **Next.js (App Router)** using:

- **Freighter Wallet** (`@stellar/freighter-api`) or **Stellar Wallets Kit** for wallet connection & signing
- **Stellar SDK** (`@stellar/stellar-sdk`) for building & submitting transactions
- **Stellar Footprint Service** (`POST /api/v1/simulate` and `POST /api/v1/restore`) for footprint extraction, fee estimation, and state restoration

By the end, you will have a copy-pasteable `useSorobanSimulation` React hook and a working transaction component.

---

## Flow Overview

```
1. Connect Freighter Wallet  ──►  Get user's publicKey
2. Build Unsigned Transaction  ──►  StellarSdk.TransactionBuilder + contract.call(...)
3. POST /api/v1/simulate       ──►  Extract optimized footprint, cost, and TTL warnings
   └─ If 422 (restore required) ──► POST /api/v1/restore -> Sign -> Submit -> Rebuild tx
4. Attach Footprint & Fee      ──►  SorobanDataBuilder + TransactionBuilder.cloneFrom(...)
5. Sign with Freighter         ──►  signTransaction(xdr, { networkPassphrase })
6. Submit to Stellar RPC       ──►  server.sendTransaction(signedTx) + poll status
```

---

## Prerequisites

- Node.js >= 22
- Next.js 14+ (App Router) or React 18+
- [Freighter Browser Extension](https://www.freighter.app/) installed and switched to **Testnet**
- Stellar Footprint Service running locally (`http://localhost:3000`) or deployed

---

## Step 1 — Install Dependencies

```bash
npm install @stellar/stellar-sdk @stellar/freighter-api
```

> **Using Stellar Wallets Kit instead?**
> You can also install `@creit.tech/stellar-wallets-kit` and swap the `signTransaction` call in Step 5 with `kit.signTransaction(xdr, { networkPassphrase })`.

Configure your environment variables in `.env.local`:

```env
NEXT_PUBLIC_FOOTPRINT_SERVICE_URL=http://localhost:3000
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK=testnet
```

---

## Step 2 — Copy-Pasteable `useSorobanSimulation` Hook

Create `hooks/useSorobanSimulation.ts`. This hook encapsulates:

- Calling `POST /api/v1/simulate`
- Detecting `SIMULATION_RESTORE_REQUIRED` (`422`) and requesting `POST /api/v1/restore`
- Attaching the optimized footprint (`readOnly` & `readWrite`) and resource fee to the transaction
- Signing with Freighter and submitting to Stellar RPC with confirmation polling

```typescript
"use client";

import { useState, useCallback } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  isConnected,
  requestAccess,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api";

export type StellarNetwork = "testnet" | "mainnet" | "futurenet";

export interface SimulationFootprint {
  readOnly: string[];
  readWrite: string[];
}

export interface SimulationCost {
  cpuInsns: string;
  memBytes: string;
  resourceFee?: string;
  totalFee?: string;
  feeInXLM?: string;
  ttlExtension?: {
    recommended: boolean;
    extendTo?: number;
    restoreFirst: boolean;
  };
}

export interface SimulationData {
  footprint: SimulationFootprint;
  cost: SimulationCost;
  ttlWarnings?: string[];
  transactionDataXdr?: string;
}

export interface RestorePrompt {
  restoreXdr: string;
  fee: string;
  resourceFee: string;
}

export type SimulationStatus =
  | "idle"
  | "building"
  | "simulating"
  | "restore_required"
  | "restoring"
  | "ready"
  | "signing"
  | "submitting"
  | "success"
  | "error";

const FOOTPRINT_API =
  process.env.NEXT_PUBLIC_FOOTPRINT_SERVICE_URL || "http://localhost:3000";
const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org";

function getNetworkPassphrase(network: StellarNetwork): string {
  switch (network) {
    case "mainnet":
      return StellarSdk.Networks.PUBLIC;
    case "futurenet":
      return StellarSdk.Networks.FUTURENET;
    case "testnet":
    default:
      return StellarSdk.Networks.TESTNET;
  }
}

export function useSorobanSimulation(network: StellarNetwork = "testnet") {
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [simulation, setSimulation] = useState<SimulationData | null>(null);
  const [restorePrompt, setRestorePrompt] = useState<RestorePrompt | null>(null);
  const [unsignedXdr, setUnsignedXdr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const networkPassphrase = getNetworkPassphrase(network);

  /**
   * Connect Freighter wallet and return the user's Stellar public key.
   */
  const connectWallet = useCallback(async (): Promise<string> => {
    const connected = await isConnected();
    if (!connected.isConnected) {
      throw new Error("Freighter wallet extension is not installed.");
    }
    await requestAccess();
    const { address, error: addrError } = await getAddress();
    if (addrError || !address) {
      throw new Error(addrError || "Failed to retrieve Freighter public key.");
    }
    return address;
  }, []);

  /**
   * Build an unsigned Soroban contract invocation and simulate it via Footprint Engine.
   */
  const simulateContractCall = useCallback(
    async (
      contractId: string,
      method: string,
      args: StellarSdk.xdr.ScVal[] = [],
    ): Promise<SimulationData | null> => {
      setError(null);
      setRestorePrompt(null);
      setTxHash(null);

      try {
        setStatus("building");
        const publicKey = await connectWallet();
        const server = new StellarSdk.rpc.Server(RPC_URL);
        const account = await server.getAccount(publicKey);
        const contract = new StellarSdk.Contract(contractId);

        const tx = new StellarSdk.TransactionBuilder(account, {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase,
        })
          .addOperation(contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const xdr = tx.toXDR();
        setUnsignedXdr(xdr);

        setStatus("simulating");
        const res = await fetch(`${FOOTPRINT_API}/api/v1/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ xdr, network }),
        });

        const body = await res.json();

        // Handle archived ledger entries (422 SIMULATION_RESTORE_REQUIRED)
        if (
          res.status === 422 &&
          (body.code === "SIMULATION_RESTORE_REQUIRED" ||
            body.type === "restoration_required")
        ) {
          const restoreRes = await fetch(`${FOOTPRINT_API}/api/v1/restore`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ xdr, network }),
          });
          const restoreJson = await restoreRes.json();
          if (restoreJson.success && restoreJson.data?.needsRestore) {
            setRestorePrompt({
              restoreXdr: restoreJson.data.restoreXdr,
              fee: restoreJson.data.fee,
              resourceFee: restoreJson.data.resourceFee,
            });
            setStatus("restore_required");
            return null;
          }
        }

        if (!res.ok || !body.success) {
          throw new Error(body.error || "Simulation failed.");
        }

        const simData: SimulationData = {
          footprint: body.footprint,
          cost: body.cost,
          ttlWarnings: body.ttlWarnings,
          transactionDataXdr: body.raw?.transactionData,
        };

        setSimulation(simData);
        setStatus("ready");
        return simData;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown simulation error";
        setError(message);
        setStatus("error");
        return null;
      }
    },
    [connectWallet, network, networkPassphrase],
  );

  /**
   * Sign and submit a restoration transaction when entries are archived.
   */
  const executeRestore = useCallback(async (): Promise<boolean> => {
    if (!restorePrompt) return false;
    setError(null);

    try {
      setStatus("restoring");
      const { signedTxXdr, error: signErr } = await signTransaction(
        restorePrompt.restoreXdr,
        { networkPassphrase },
      );
      if (signErr || !signedTxXdr) {
        throw new Error(signErr || "User declined restoration signature.");
      }

      const server = new StellarSdk.rpc.Server(RPC_URL);
      const restoreTx = StellarSdk.TransactionBuilder.fromXDR(
        signedTxXdr,
        networkPassphrase,
      );
      const sent = await server.sendTransaction(restoreTx);

      let result = await server.getTransaction(sent.hash);
      while (result.status === "NOT_FOUND") {
        await new Promise((r) => setTimeout(r, 1500));
        result = await server.getTransaction(sent.hash);
      }

      if (result.status !== "SUCCESS") {
        throw new Error(`Restoration failed with status: ${result.status}`);
      }

      setRestorePrompt(null);
      setStatus("idle");
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to restore ledger entries";
      setError(message);
      setStatus("error");
      return false;
    }
  }, [networkPassphrase, restorePrompt]);

  /**
   * Attach the optimized footprint, sign with Freighter, and submit to Stellar RPC.
   */
  const signAndSubmit = useCallback(async (): Promise<string | null> => {
    if (!unsignedXdr || !simulation) {
      setError("Run simulateContractCall before signing.");
      return null;
    }

    setError(null);
    try {
      const originalTx = StellarSdk.TransactionBuilder.fromXDR(
        unsignedXdr,
        networkPassphrase,
      ) as StellarSdk.Transaction;

      // Attach optimized footprint & resource fee
      let sorobanData: StellarSdk.xdr.SorobanTransactionData;
      if (simulation.transactionDataXdr) {
        sorobanData = StellarSdk.xdr.SorobanTransactionData.fromXDR(
          simulation.transactionDataXdr,
          "base64",
        );
      } else {
        const readOnly = simulation.footprint.readOnly.map((k) =>
          StellarSdk.xdr.LedgerKey.fromXDR(k, "base64"),
        );
        const readWrite = simulation.footprint.readWrite.map((k) =>
          StellarSdk.xdr.LedgerKey.fromXDR(k, "base64"),
        );
        const resourceFee = simulation.cost.resourceFee || "100000";
        sorobanData = new StellarSdk.SorobanDataBuilder()
          .setFootprint(readOnly, readWrite)
          .setResourceFee(resourceFee)
          .build();
      }

      const assembledTx = StellarSdk.TransactionBuilder.cloneFrom(originalTx, {
        sorobanData,
        fee: simulation.cost.totalFee || StellarSdk.BASE_FEE,
      }).build();

      setStatus("signing");
      const { signedTxXdr, error: signErr } = await signTransaction(
        assembledTx.toXDR(),
        { networkPassphrase },
      );
      if (signErr || !signedTxXdr) {
        throw new Error(signErr || "Transaction signing was cancelled.");
      }

      setStatus("submitting");
      const server = new StellarSdk.rpc.Server(RPC_URL);
      const signedTx = StellarSdk.TransactionBuilder.fromXDR(
        signedTxXdr,
        networkPassphrase,
      );
      const sendResult = await server.sendTransaction(signedTx);

      let txResponse = await server.getTransaction(sendResult.hash);
      while (txResponse.status === "NOT_FOUND") {
        await new Promise((r) => setTimeout(r, 1500));
        txResponse = await server.getTransaction(sendResult.hash);
      }

      if (txResponse.status !== "SUCCESS") {
        throw new Error(`Transaction failed: ${txResponse.status}`);
      }

      setTxHash(sendResult.hash);
      setStatus("success");
      return sendResult.hash;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Transaction submission failed";
      setError(message);
      setStatus("error");
      return null;
    }
  }, [networkPassphrase, simulation, unsignedXdr]);

  return {
    status,
    simulation,
    restorePrompt,
    txHash,
    error,
    simulateContractCall,
    executeRestore,
    signAndSubmit,
  };
}
```

---

## Step 3 — Build the UI Component (Fee Breakdown + Sign & Submit)

Use `useSorobanSimulation` inside a Next.js Client Component (`components/ContractInvoker.tsx`) to show the user a clear fee breakdown before they sign:

```tsx
"use client";

import * as StellarSdk from "@stellar/stellar-sdk";
import { useSorobanSimulation } from "@/hooks/useSorobanSimulation";

interface ContractInvokerProps {
  contractId: string;
}

export function ContractInvoker({ contractId }: ContractInvokerProps) {
  const {
    status,
    simulation,
    restorePrompt,
    txHash,
    error,
    simulateContractCall,
    executeRestore,
    signAndSubmit,
  } = useSorobanSimulation("testnet");

  const handleSimulate = async () => {
    await simulateContractCall(contractId, "hello", [
      StellarSdk.nativeToScVal("world", { type: "string" }),
    ]);
  };

  const handleRestoreAndRetry = async () => {
    const restored = await executeRestore();
    if (restored) {
      await handleSimulate(); // Rebuilds tx with updated sequence number
    }
  };

  return (
    <div className="max-w-lg rounded-xl border p-6 space-y-4">
      <h2 className="text-lg font-semibold">Soroban Contract Call</h2>

      <button
        onClick={handleSimulate}
        disabled={status === "building" || status === "simulating"}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {status === "simulating" ? "Simulating..." : "Simulate Transaction"}
      </button>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {status === "restore_required" && restorePrompt && (
        <div className="rounded-md bg-amber-50 p-4 space-y-2 text-sm">
          <p className="font-medium text-amber-900">
            Contract state is archived and must be restored first.
          </p>
          <p className="text-amber-800">
            Estimated restoration fee: {restorePrompt.fee} stroops
          </p>
          <button
            onClick={handleRestoreAndRetry}
            className="rounded bg-amber-600 px-3 py-1.5 text-white"
          >
            Restore State &amp; Re-simulate
          </button>
        </div>
      )}

      {simulation && status === "ready" && (
        <div className="rounded-md bg-slate-50 p-4 space-y-2 text-sm">
          <h3 className="font-medium">Simulation &amp; Fee Breakdown</h3>
          <ul className="space-y-1 text-slate-700">
            <li>CPU Instructions: {simulation.cost.cpuInsns}</li>
            <li>Memory Bytes: {simulation.cost.memBytes}</li>
            <li>Read-Only Keys: {simulation.footprint.readOnly.length}</li>
            <li>Read-Write Keys: {simulation.footprint.readWrite.length}</li>
            {simulation.cost.feeInXLM && (
              <li className="font-semibold">
                Estimated Total Fee: {simulation.cost.feeInXLM} XLM
              </li>
            )}
          </ul>

          {simulation.ttlWarnings && simulation.ttlWarnings.length > 0 && (
            <p className="text-xs text-amber-700">
              TTL Warning: {simulation.ttlWarnings[0]}
            </p>
          )}

          <button
            onClick={signAndSubmit}
            className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-white"
          >
            Sign with Freighter &amp; Submit
          </button>
        </div>
      )}

      {status === "success" && txHash && (
        <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          Transaction confirmed! Hash: <code>{txHash}</code>
        </div>
      )}
    </div>
  );
}
```

---

## Step 4 — Handling CORS in Local Development

When running Next.js on `http://localhost:3001` and the Footprint Service on `http://localhost:3000`:

- In `development` mode (`NODE_ENV=development`), the Footprint Service sets `Access-Control-Allow-Origin: *` by default.
- In `production`, set `CORS_ORIGIN=https://your-dapp.example.com` in your Footprint Service `.env`.

---

## Related Guides

- [Freighter Wallet Integration Guide](../guides/wallet-integration.md)
- [Soroban State Archival & Restoration Lifecycle](../guides/state-archival-and-restoration.md)
- [Error Handling Guide](../guides/error-handling.md)
