# Footprint Optimization Patterns to Minimize Soroban Fees

Every Soroban transaction declares a **footprint**—the exact set of ledger keys it will read (`readOnly`) or read and write (`readWrite`). Because Soroban resource fees are directly proportional to the size and access mode of your footprint, optimizing how your smart contract organizes and accesses state can dramatically lower transaction costs for your users.

If you are new to footprints, start with [Understanding Soroban Footprints](./understanding-footprints.md) first.

---

## How Soroban Resource Fees Are Calculated

Under Stellar's Soroban fee model (CAP-0046), a transaction's total fee has two parts:

1. **Inclusion Fee (Base Fee):** Competes for ledger inclusion (minimum `100` stroops per operation, or the network's p50 Soroban inclusion fee).
2. **Resource Fee:** Pays for the exact compute, bandwidth, and ledger overhead consumed during execution.

As modeled in `src/services/feeEstimator.ts`, the resource fee is driven by four components:

| Component | Formula / Rate (Network Defaults) | What Drives Cost |
|---|---|---|
| **CPU Fee** | `ceil(cpuInsns / 10_000) * 25` stroops | Number of WASM instructions executed (including serialization/deserialization of storage entries) |
| **Write Fee** | `writeBytes * 1,000` stroops | Bytes written to ledger (`readWrite` footprint entries + new/updated entry values) |
| **Read Fee** | `readBytes * 250` stroops | Bytes read from ledger (`readOnly` + `readWrite` entries loaded into memory) |
| **Overhead Fee** | `(txOverheadBytes + footprintBytes) * (100 + 100)` stroops | Historical archive + transaction metadata bytes (`footprintBytes` = serialized XDR keys) |

Notice two critical takeaways:
- **Write bandwidth is 4x more expensive than read bandwidth** (`1,000` stroops/byte vs `250` stroops/byte).
- **Every unnecessary ledger key in the footprint** increases `footprintBytes`, `readBytes`, and `cpuInsns` (from decoding unused data).

You can inspect these exact breakdowns for any transaction using `POST /api/v1/simulate` (look at `footprint.breakdown` and `cost`) or the CLI command `sfe cost <xdr>`.

---

## 5 Concrete Optimization Patterns for Soroban Contracts

### 1. Prefer Read-Only Keys Over Read-Write Keys

**Problem:** Marking a ledger key as `readWrite` when the contract only reads it forces the network to charge write bandwidth and serialize the key as mutable state—preventing parallel execution with other transactions reading the same key.

**Pattern:**
- Never call `env.storage().persistent().set(...)` or `extend_ttl` unnecessarily on read paths.
- Keep configuration, oracle prices, and pool metadata in separate keys from mutable balances or reserves so read-only queries never touch `readWrite` keys.
- Use `POST /api/v1/footprint/diff` before and after contract changes to verify that read-only paths only produce `RO` entries.

```rust
// Bad: Mutates or extends a shared config key on every swap
let mut cfg: PoolConfig = env.storage().instance().get(&DataKey::Config).unwrap();
cfg.last_accessed = env.ledger().sequence();
env.storage().instance().set(&DataKey::Config, &cfg); // Forces Config into readWrite!

// Good: Read config without writing back
let cfg: PoolConfig = env.storage().instance().get(&DataKey::Config).unwrap();
```

---

### 2. Use Temporary Storage for Ephemeral State

**Problem:** `Persistent` storage entries incur long-term state archival rent and require restoration (`RestoreFootprint`) if they expire. Storing short-lived data in `Persistent` storage wastes rent and bloats your contract's persistent footprint.

**Pattern:**
Use `env.storage().temporary()` for data that only needs to live for a single transaction, a few ledgers, or a short session:
- Reentrancy / flash-loan locks
- Per-ledger rate-limit or nonce counters
- Short-lived TWAP/oracle caches or commit-reveal commitments

```rust
// Bad: Using persistent storage for a short-lived nonce or lock
env.storage().persistent().set(&DataKey::SwapNonce(user.clone()), &nonce);

// Good: Temporary storage avoids archival restoration & lowers rent overhead
env.storage().temporary().set(&DataKey::SwapNonce(user.clone()), &nonce);
```

---

### 3. Avoid Monolithic Storage Maps (Split into Keyed Entries)

**Problem:** A single `Map<Address, Balance>` or `Vec<PoolEntry>` stored under one `DataKey` forces **every** transaction to load, deserialize, and re-serialize the **entire** collection—even when touching a single user. As the map grows, `readBytes`, `writeBytes`, and `cpuInsns` grow linearly until transactions hit Soroban resource limits.

**Pattern:**
Split collections into individual ledger entries keyed by the entity identifier:

```rust
// Bad: Monolithic Map — every swap reads and writes ALL users' balances
#[contracttype]
pub enum DataKey {
    AllBalances, // Map<Address, i128>
}

// Good: Per-user ledger entries — each swap touches only the caller's entry
#[contracttype]
pub enum DataKey {
    Balance(Address),
}
```

Each transaction then includes only `Balance(caller)` in its footprint, keeping `readBytes`, `writeBytes`, and `cpuInsns` constant (`O(1)`) regardless of total user count.

---

### 4. Minimize Contract Instance Storage Bloat

**Problem:** A contract's `ContractInstance` key (which holds `env.storage().instance()`) is **automatically loaded into the footprint on every invocation** of that contract—even if the called function doesn't read instance storage. Large structs, token lists, or historical arrays stored in `instance()` inflate `readBytes` and `cpuInsns` on every single call.

**Pattern:**
- Reserve `env.storage().instance()` strictly for small, always-needed metadata (e.g., `admin: Address`, `token_a: Address`, `token_b: Address`, `fee_bps: u32`).
- Move anything that is only needed by specific methods (e.g., governance proposals, reward schedules, user positions) into `Persistent` or `Temporary` storage under dedicated `DataKey`s.

---

### 5. Prune Redundant Cross-Contract Calls and Pack Data Types

**Problem:** Each cross-contract call adds the target contract's `ContractCode` (WASM) and `ContractInstance` keys to the transaction footprint. Similarly, verbose `String` keys or uncompressed structs increase serialized XDR size.

**Pattern:**
- **Cache immutable values locally:** If your AMM contract frequently checks a token's `decimals()`, read it once during initialization and store the `u32` in instance storage instead of making a cross-contract call on every swap.
- **Use compact types:** Prefer `u32` / `u64` / `Symbol` over `String`, and fixed-size enums over nested structs.
- **Inspect with `footprint.breakdown`:** Call `POST /api/v1/simulate` and check `footprint.breakdown.contractCode`, `contractInstance`, `persistentData`, and `temporaryData` to spot unexpected cross-contract keys.

---

## Before-and-After Fee Comparison: Example AMM Swap

Consider a standard token swap (`swap(user, amount_in, min_out)`) on an AMM pool with 5,000 liquidity providers.

### Unoptimized Design
- Pool balances stored in a monolithic `Map<Address, i128>` (~24 KB serialized).
- Swap updates `last_swap_ledger` in `ContractInstance` (forces `ContractInstance` into `readWrite`).
- Records a short-lived anti-MEV nonce in `Persistent` storage.
- Queries `token_a.decimals()` and `token_b.decimals()` via cross-contract calls on every swap.

### Optimized Design
- Pool balances split into individual `Persistent` keys (`DataKey::LpBalance(Address)`).
- `ContractInstance` holds only immutable pool config (`token_a`, `token_b`, `fee_bps`, `decimals_a`, `decimals_b`) and stays `readOnly`.
- Anti-MEV nonce moved to `Temporary` storage.
- Token decimals cached at initialization (no extra cross-contract calls).

### Resource & Fee Comparison Table

| Metric | Before (Unoptimized) | After (Optimized) | Savings |
|---|---|---|---|
| **Footprint `readOnly` keys** | 6 keys (2 token WASMs, 2 token instances, pool WASM, config) | 4 keys (2 token WASMs, pool WASM, pool instance) | -33% keys |
| **Footprint `readWrite` keys** | 4 keys (pool instance, monolithic LP map, persistent nonce, token balances) | 3 keys (caller LP balance, temp nonce, token balances) | -25% keys |
| **CPU Instructions (`cpuInsns`)** | ~18,500,000 | ~4,200,000 | **-77%** |
| **Read Bandwidth (`readBytes`)** | ~28,400 bytes | ~3,600 bytes | **-87%** |
| **Write Bandwidth (`writeBytes`)** | ~24,800 bytes | ~1,100 bytes | **-96%** |
| **Estimated CPU Fee** | ~46,250 stroops | ~10,500 stroops | -35,750 stroops |
| **Estimated Read + Write Fee** | ~31,900,000 stroops | ~2,000,000 stroops | -29,900,000 stroops |
| **Estimated Total Resource Fee** | **~3.19 XLM** | **~0.20 XLM** | **~94% reduction** |

> [!NOTE]
> Exact stroop figures depend on current network fee parameters (`getFeeStats`) and contract WASM size. Use `POST /api/v1/simulate` or `sfe cost <xdr>` against Testnet to measure your contract's exact numbers.

---

## Further Reading

- [Understanding Soroban Footprints](./understanding-footprints.md)
- [State Archival & Restoration Lifecycle](./state-archival-and-restoration.md)
- [Architecture Overview](../architecture.md)
