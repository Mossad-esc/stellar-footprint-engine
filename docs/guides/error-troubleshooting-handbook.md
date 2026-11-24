# Soroban Simulation Error Troubleshooting Handbook & FAQ

A comprehensive reference mapping cryptic Soroban RPC host errors to plain-English explanations, root-cause analyses, concrete remediation steps, and copy-pasteable code snippets.

---

## Table of Contents

- [Overview](#overview)
- [How to Diagnose Soroban Errors](#how-to-diagnose-soroban-errors)
- [Error Catalog](#error-catalog)
  - [1. Storage Errors](#1-storage-errors)
    - [Error 1: `HostError: Error(Storage, MissingValue)`](#error-1-hosterror-errorstorage-missingvalue)
    - [Error 2: `HostError: Error(Storage, ExistingValue)`](#error-2-hosterror-errorstorage-existingvalue)
    - [Error 3: `HostError: Error(Storage, ReadOnly)`](#error-3-hosterror-errorstorage-readonly)
  - [2. Budget & Resource Limit Errors](#2-budget--resource-limit-errors)
    - [Error 4: `HostError: Error(Budget, ExceededLimit)` (CPU Instructions)](#error-4-hosterror-errorbudget-exceededlimit-cpu-instructions)
    - [Error 5: `HostError: Error(Budget, ExceededLimit)` (Memory Bytes)](#error-5-hosterror-errorbudget-exceededlimit-memory-bytes)
    - [Error 6: `RESOURCE_LIMIT_EXCEEDED` (Footprint Size Limit)](#error-6-resource_limit_exceeded-footprint-size-limit)
  - [3. Authentication & Signature Errors](#3-authentication--signature-errors)
    - [Error 7: `HostError: Error(Auth, InvalidAction)` / Unauthorized](#error-7-hosterror-errorauth-invalidaction--unauthorized)
    - [Error 8: `HostError: Error(Auth, BadNonce)`](#error-8-hosterror-errorauth-badnonce)
    - [Error 9: `HostError: Error(Auth, SignatureExpired)`](#error-9-hosterror-errorauth-signatureexpired)
  - [4. State Archival & Restoration Errors](#4-state-archival--restoration-errors)
    - [Error 10: `SIMULATION_RESTORE_REQUIRED` (Expired Entry)](#error-10-simulation_restore_required-expired-entry)
    - [Error 11: `HostError: Error(Storage, Archival)`](#error-11-hosterror-errorstorage-archival)
    - [Error 12: `FootprintMissingRestore`](#error-12-footprintmissingrestore)
  - [5. RPC & Execution Errors](#5-rpc--execution-errors)
    - [Error 13: `HostError: Error(WasmVm, Trap)` (Wasm Panic)](#error-13-hosterror-errorwasmvm-trap-wasm-panic)
    - [Error 14: `TX_BAD_SEQ` (Account Sequence Mismatch)](#error-14-tx_bad_seq-account-sequence-mismatch)
    - [Error 15: `HOST_SUBMISSION_TIMEOUT` / RPC Network Timeout](#error-15-host_submission_timeout--rpc-network-timeout)
- [Frequently Asked Questions (FAQ)](#frequently-asked-questions-faq)
  - [Q1: Why does a simulation succeed locally or via RPC, but fail when submitted?](#q1-why-does-a-simulation-succeed-locally-or-via-rpc-but-fail-when-submitted)
  - [Q2: How do I view detailed debug logs and diagnostic events from simulation?](#q2-how-do-i-view-detailed-debug-logs-and-diagnostic-events-from-simulation)
  - [Q3: What is the practical difference between Instance, Persistent, and Temporary storage?](#q3-what-is-the-practical-difference-between-instance-persistent-and-temporary-storage)
  - [Q4: How do I avoid manual footprint assembly in my frontend or backend?](#q4-how-do-i-avoid-manual-footprint-assembly-in-my-frontend-or-backend)
  - [Q5: How can dApps proactively prevent state archival of contract instances?](#q5-how-can-dapps-proactively-prevent-state-archival-of-contract-instances)

---

## Overview

When simulating smart contract invocations on Stellar via Soroban RPC, errors are returned as structured `HostError` envelopes containing an error type and reason code. Because host errors originate from the WebAssembly host environment rather than standard HTTP or JSON responses, deciphering them requires understanding Soroban's storage models, execution budgets, and authorization framework.

This handbook maps the **top 15 Soroban host and simulation errors** into practical solutions with code snippets.

---

## How to Diagnose Soroban Errors

When calling `/simulate` or native Soroban RPC `simulateTransaction`, always check the following response fields:

1. **`error` / `result.error`**: The primary host error description string.
2. **`events`**: Diagnostic events emitted prior to the failure.
3. **`restorePreamble`**: Indicates that one or more persistent entries have expired and must be restored before the simulation can execute.

```typescript
import { simulateViaRpc } from "./rpcClient";

// Example simulation inspect
const response = await simulateViaRpc(tx, "testnet");

if ("error" in response && response.error) {
  console.error("Simulation failed:", response.error);
  // Inspect diagnostic events if available
  if (Array.isArray(response.events)) {
    response.events.forEach((evt) => console.log("Event:", evt));
  }
}
```

---

## Error Catalog

### 1. Storage Errors

---

#### Error 1: `HostError: Error(Storage, MissingValue)`

- **Plain English:** The smart contract tried to read a storage key that does not exist in ledger storage or has not been initialized yet.
- **Root Cause:** A call to `env.storage().instance().get(&key)` or `env.storage().persistent().get(&key)` returned `None`, and the contract attempted an unwrap or required the key to exist.
- **Typical Trigger:** Invoking a contract function before calling its initialization method (e.g., trying to read an admin address or token balance before setting it).
- **How to Fix:**
  1. Verify the contract has been properly initialized.
  2. In your Rust contract, use `get(&key).unwrap_or(default_value)` instead of `.unwrap()`.
  3. Ensure the address or identifier passed as an argument matches an existing record.
- **Code Snippet:**

```rust
// In Soroban smart contract:
// ❌ Dangerous: will throw Error(Storage, MissingValue) if uninitialized
let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();

// ✅ Safe: Check existence or provide a fallback
let admin = env.storage().instance().get(&DataKey::Admin);
if admin.is_none() {
    return Err(ContractError::NotInitialized);
}
```

```typescript
// In Client TypeScript: Verify initialization before calling contract methods
const isInitialized = await client.simulateTransaction(checkInitTx);
if (!isInitialized) {
  await client.submitTransaction(initializeContractTx);
}
```

---

#### Error 2: `HostError: Error(Storage, ExistingValue)`

- **Plain English:** The contract attempted to create a storage entry that is already present.
- **Root Cause:** The contract logic asserts uniqueness on a storage entry or calls an internal initializer that rejects re-initialization.
- **Typical Trigger:** Calling an `initialize()` or `register()` function more than once with the same admin or identifier.
- **How to Fix:**
  1. Check whether the contract instance is already initialized before sending initialization transactions.
  2. Implement an update or setter function instead of re-invoking the constructor/initializer.
- **Code Snippet:**

```rust
// Contract check: prevent re-initialization panic
pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
    if env.storage().instance().has(&DataKey::Admin) {
        return Err(ContractError::AlreadyInitialized);
    }
    env.storage().instance().set(&DataKey::Admin, &admin);
    Ok(())
}
```

---

#### Error 3: `HostError: Error(Storage, ReadOnly)`

- **Plain English:** The contract tried to modify or write to a ledger entry that was marked as "read-only" in the transaction footprint.
- **Root Cause:** In Soroban, any ledger key written to during execution must be pre-declared in the transaction envelope's `readWrite` footprint. If it is only listed in `readOnly`, mutation triggers an immediate host violation.
- **Typical Trigger:** Manually crafting or modifying transaction footprints without simulating through the Stellar Footprint Engine first.
- **How to Fix:**
  1. Do not manually hardcode footprint entries.
  2. Use `POST /api/v1/simulate` or `POST /api/v1/footprint` to generate the complete, correct `readWrite` footprint automatically.
- **Code Snippet:**

```typescript
// Client fix using stellar-footprint-engine:
import axios from "axios";

// 1. Simulate the transaction to extract correct footprints
const { data } = await axios.post("http://localhost:3000/api/v1/simulate", {
  xdr: unsignedTxXdr,
  network: "testnet",
});

// 2. The service automatically populates the required readWrite entries
console.log("Read-Write Footprint:", data.footprint.readWrite);
```

---

### 2. Budget & Resource Limit Errors

---

#### Error 4: `HostError: Error(Budget, ExceededLimit)` (CPU Instructions)

- **Plain English:** The contract execution ran more CPU instructions than the protocol maximum limit allows.
- **Root Cause:** Infinite loops, unbounded loops over growing arrays or maps, or heavy cryptographic operations within a single contract call.
- **Typical Trigger:** Iterating over a collection that has grown beyond a few hundred items (e.g., distributing tokens to all users in a single transaction).
- **How to Fix:**
  1. Break large operations into batches across multiple transactions.
  2. Store collections across multiple discrete ledger keys rather than a single monolithic vector.
  3. Avoid complex on-chain sorting or excessive string formatting.
- **Code Snippet:**

```rust
// ❌ Antipattern: iterating over an unbounded vector in one invocation
for recipient in large_list.iter() {
    process_payout(&env, recipient);
}

// ✅ Correct: process in small, deterministic chunks (e.g., 25 items max)
pub fn batch_payout(env: Env, recipients_slice: Vec<Address>) {
    for recipient in recipients_slice.iter() {
        process_payout(&env, recipient);
    }
}
```

---

#### Error 5: `HostError: Error(Budget, ExceededLimit)` (Memory Bytes)

- **Plain English:** The contract allocated more memory (RAM) in the WebAssembly virtual machine than allowed by the network parameters.
- **Root Cause:** Loading huge data structures into memory at once or creating large temporary buffers.
- **Typical Trigger:** Deserializing a massive contract storage entry (> 64 KB) or concatenating large byte strings.
- **How to Fix:**
  1. Paginate large datasets.
  2. Store granular state in keyed sub-entries instead of a single giant struct.
- **Code Snippet:**

```rust
// Granular storage keys instead of monolithic storage
#[contracttype]
pub enum DataKey {
    UserRecord(Address), // each user gets their own entry
}

pub fn set_user(env: &Env, user: Address, data: UserData) {
    env.storage().persistent().set(&DataKey::UserRecord(user), &data);
}
```

---

#### Error 6: `RESOURCE_LIMIT_EXCEEDED` (Footprint Size Limit)

- **Plain English:** The combined number of read/write ledger entries or total byte size of entries in the footprint exceeds protocol limits.
- **Root Cause:** A single transaction envelope references too many ledger entries across different contracts or state variables.
- **Typical Trigger:** Complex composability transactions that touch dozens of external liquidity pools or cross-contract instances in one envelope.
- **How to Fix:**
  1. Inspect the footprint using `POST /api/v1/utilities/footprint-diff`.
  2. Decouple the workflow into a two-step multi-transaction pipeline.

---

### 3. Authentication & Signature Errors

---

#### Error 7: `HostError: Error(Auth, InvalidAction)` / Unauthorized

- **Plain English:** The contract required authorization from an address (e.g. caller or admin), but no valid signature was supplied.
- **Root Cause:** The contract called `address.require_auth()` or `address.require_auth_for_args(...)`, and the transaction envelope was missing the corresponding Soroban authorization entry.
- **Typical Trigger:** Invoking a protected function from a frontend wallet without requesting authorization credentials for all required accounts.
- **How to Fix:**
  1. Ensure the wallet signers match the addresses expected by the contract.
  2. When preparing the transaction with Stellar SDK, simulate first so the SDK automatically populates `SorobanAuthorizationEntry` trees.
- **Code Snippet:**

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

// Simulating populates authorization credentials automatically
const server = new StellarSdk.rpc.Server("https://soroban-testnet.stellar.org");
const simulatedTx = await server.prepareTransaction(rawTx);

// Sign with user wallet
const signedTx = await userKeypairOrWallet.sign(simulatedTx);
```

---

#### Error 8: `HostError: Error(Auth, BadNonce)`

- **Plain English:** The authorization nonce provided does not match the on-chain sequence expected for this signer.
- **Root Cause:** Replay protection failed. Either an old signature was resubmitted, or concurrent transactions from the same account jumped ahead of the expected authorization sequence.
- **Typical Trigger:** Submitting multiple transactions in rapid parallel without awaiting confirmation of the previous nonce.
- **How to Fix:**
  1. Ensure nonces or sequence numbers are read immediately before simulation.
  2. Serialize transaction submissions for the same account or use channels/claimable balances.

---

#### Error 9: `HostError: Error(Auth, SignatureExpired)`

- **Plain English:** The signature or authorization approval had an expiration ledger sequence that is already in the past.
- **Root Cause:** The authorization envelope was configured with a validity ledger sequence that expired before the transaction was validated by network validators.
- **Typical Trigger:** High network congestion delaying submission past the valid ledger window, or a client setting an overly aggressive validity timeframe.
- **How to Fix:**
  1. Use a generous timeout window (e.g., current ledger + 30 ledgers ~ 2.5 minutes).
  2. Regenerate signatures if transaction submission is delayed.

---

### 4. State Archival & Restoration Errors

---

#### Error 10: `SIMULATION_RESTORE_REQUIRED` (Expired Entry)

- **Plain English:** A persistent ledger entry or contract instance has run out of rent (TTL) and has been moved to cold storage (archived).
- **Root Cause:** Soroban State Archival. Any entry whose `liveUntilLedger` falls below the current ledger sequence becomes inactive and cannot be read or written until restored.
- **Typical Trigger:** Interacting with a contract that hasn't received transactions in several weeks or months.
- **How to Fix:**
  1. Call `POST /api/v1/restore` with your transaction XDR.
  2. Sign and submit the returned `RestoreFootprintOp` transaction.
  3. Once confirmed on-chain, re-simulate and submit your original transaction.
- **Code Snippet:**

```typescript
import axios from "axios";

async function handleSimulation(txXdr: string) {
  try {
    const res = await axios.post("http://localhost:3000/api/v1/simulate", {
      xdr: txXdr,
      network: "testnet",
    });
    return res.data;
  } catch (err: any) {
    if (err.response?.data?.code === "SIMULATION_RESTORE_REQUIRED") {
      console.warn("Restoration needed! Generating restore transaction...");
      
      const restoreRes = await axios.post("http://localhost:3000/api/v1/restore", {
        xdr: txXdr,
        network: "testnet",
      });

      const restoreTxXdr = restoreRes.data.data.restoreTransactionXdr;
      // 1. Sign & submit restoreTxXdr to network
      // 2. Retry original simulation
    }
    throw err;
  }
}
```

---

#### Error 11: `HostError: Error(Storage, Archival)`

- **Plain English:** A contract attempted to query archived data that was not restored prior to invocation.
- **Root Cause:** Direct on-chain equivalent of `SIMULATION_RESTORE_REQUIRED`. The footprint lacked the necessary active state.
- **How to Fix:**
  - Execute a restore operation prior to invoking the contract.

---

#### Error 12: `FootprintMissingRestore`

- **Plain English:** The transaction attempted to execute a contract call whose footprint references archived entries, but does not contain a preceding `RestoreFootprintOp`.
- **How to Fix:**
  - Keep restoration operations separate from invocation operations. A transaction that invokes a contract cannot restore the contract's own instance in the same operation envelope.

---

### 5. RPC & Execution Errors

---

#### Error 13: `HostError: Error(WasmVm, Trap)` (Wasm Panic)

- **Plain English:** The smart contract crashed or panicked inside WebAssembly.
- **Root Cause:** Common programming panics:
  - Integer overflow or division by zero (e.g. `a / 0`).
  - Out-of-bounds array access (`vec.get(10)` when length is 5).
  - Explicit `panic!()` or failed `assert!()` in contract Rust code.
- **Typical Trigger:** Passing invalid arguments, zero amounts, or violating contract state assertions.
- **How to Fix:**
  1. Check contract diagnostic events to locate the panic line.
  2. Add unit tests in Rust with `soroban-sdk` to reproduce the exact parameters.
  3. Use checked arithmetic (`checked_add`, `checked_div`).
- **Code Snippet:**

```rust
// ❌ Dangerous: will trap on overflow or division by zero
let share = total_pool / user_count; 

// ✅ Safe: checked math
let share = total_pool
    .checked_div(user_count)
    .ok_or(ContractError::InvalidUserCount)?;
```

---

#### Error 14: `TX_BAD_SEQ` (Account Sequence Mismatch)

- **Plain English:** The account sequence number on the transaction envelope is wrong.
- **Root Cause:** The source account's sequence on the Stellar ledger is higher than or equal to the sequence number specified in the envelope.
- **Typical Trigger:** Submitting multiple transactions from the same account without incrementing the sequence number or fetching the latest account state.
- **How to Fix:**
  - Refresh the source account sequence number before building the transaction envelope.
- **Code Snippet:**

```typescript
const account = await server.getAccount(sourcePublicKey);
const tx = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET,
})
  .addOperation(...)
  .setTimeout(30)
  .build();
```

---

#### Error 15: `HOST_SUBMISSION_TIMEOUT` / RPC Network Timeout

- **Plain English:** The RPC server took too long to simulate the transaction or query ledger state.
- **Root Cause:** Public node tail latency, network congestion, or garbage collection spikes.
- **Typical Trigger:** High network activity on public testnet RPC nodes.
- **How to Fix:**
  1. Utilize the **Adaptive Request Hedging** feature in `rpcClient.ts` (`hedgedSimulate()`), which speculatively queries backup RPC nodes after 600 ms.
  2. Implement exponential backoff for transient errors.

---

## Frequently Asked Questions (FAQ)

### Q1: Why does a simulation succeed locally or via RPC, but fail when submitted?
**Answer:** Simulation runs against a snapshot of the current ledger state without acquiring execution locks. Between simulation and transaction submission:
1. Another transaction may have modified the contract storage or balance.
2. The account sequence number may have progressed.
3. Persistent entries may have expired if simulated near a ledger boundary.

Always verify your account sequence numbers and set reasonable ledger expiration bounds.

---

### Q2: How do I view detailed debug logs and diagnostic events from simulation?
**Answer:** The RPC simulation response returns an `events` array containing XDR diagnostic records. You can decode these events using Stellar SDK:

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

function printDiagnosticEvents(simResponse: any) {
  if (!simResponse.events) return;

  for (const rawEvent of simResponse.events) {
    const event = StellarSdk.xdr.DiagnosticEvent.fromXDR(rawEvent, "base64");
    if (event.inSuccessfulContractCall()) {
      console.log("Success Event:", event.event().data());
    } else {
      console.warn("Error Event:", event.event().data());
    }
  }
}
```

---

### Q3: What is the practical difference between Instance, Persistent, and Temporary storage?
**Answer:**
- **Instance Storage:** Tied to the contract executable itself. Shared across the entire contract instance. Expired instance storage causes the entire contract to become inactive.
- **Persistent Storage:** Long-lived user data (e.g. user balances). When rent expires, persistent storage is **archived** and can be revived with a `RestoreFootprintOp`.
- **Temporary Storage:** Short-lived data (e.g. session nonces, price oracle signatures). When rent expires, temporary storage is **permanently deleted** and cannot be restored.

---

### Q4: How do I avoid manual footprint assembly in my frontend or backend?
**Answer:** Never manually specify ledger keys in footprints. Always use the **Stellar Footprint Engine**:
```http
POST /api/v1/simulate
Content-Type: application/json

{
  "xdr": "AAAAAgAAAA...",
  "network": "testnet"
}
```
The response returns pre-calculated, verified `readOnly` and `readWrite` footprint XDR entries ready for transaction building.

---

### Q5: How can dApps proactively prevent state archival of contract instances?
**Answer:** Use `ExtendFootprintTTLOp`. Contracts and dApps should monitor remaining ledger lifetimes using the engine's `POST /api/v1/utilities/ttl-info` endpoint and issue extension operations whenever the remaining lifetime drops below the safety threshold (e.g. 100,000 ledgers).

---

## Related Documentation

- [Error Handling Guide](./error-handling.md)
- [Soroban State Archival & Restoration Lifecycle](./state-archival-and-restoration.md)
- [Understanding Soroban Footprints](./understanding-footprints.md)
- [Footprint Optimization Patterns](./footprint-optimization.md)
