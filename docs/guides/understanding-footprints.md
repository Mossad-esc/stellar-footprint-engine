# Understanding Soroban Footprints

## What is a Soroban Footprint?

In the Stellar network, when you execute a smart contract (known as a Soroban contract), the network needs to know which parts of the ledger state your contract will access. This is called the "footprint" of the transaction.

Think of it like a blueprint: before executing your contract, the Stellar network needs to know exactly which accounts, contracts, and ledger entries your code will read from or write to. This allows the network to:

1. **Prevent conflicts** - Ensure two transactions don't try to modify the same state simultaneously
2. **Enable parallel processing** - Allow non-conflicting transactions to be processed concurrently
3. **Provide strong consistency** - Guarantee that your transaction sees a consistent view of the state

## Why Are Footprints Required?

Without footprints, the Stellar network would have to:

- Lock the entire ledger state during contract execution (severely limiting throughput)
- Or risk inconsistent states when contracts access overlapping parts of the ledger

By declaring your footprint upfront, the network can:

- Process multiple transactions in parallel when their footprints don't overlap
- Detect and prevent conflicting transactions before they execute
- Provide developers with predictable, isolated execution environments

## The Problem: Manual Footprint Management

Before the Stellar Footprint Service, developers had to manually calculate and manage footprints, which was error-prone and complex:

### Manual Process:

1. Analyze your contract code to identify all potential ledger accesses
2. Manually enumerate every account, contract, and ledger entry your transaction might touch
3. Update this list every time your contract code changes
4. Risk missing an access, leading to transaction failures
5. Over-approximate to be safe, reducing concurrency benefits

This approach was:

- **Time-consuming**: Developers spent hours analyzing contract interactions
- **Error-prone**: Easy to miss accesses or include unnecessary ones
- **Fragile**: Required updates whenever contract logic changed
- **Suboptimal**: Often led to over-approximation, reducing network efficiency

## The Solution: Stellar Footprint Service

The Stellar Footprint Service automates footprint calculation, eliminating manual work and ensuring accuracy:

### How It Works:

1. **Simulation**: You provide a transaction simulation request
2. **Analysis**: The service examines what ledger entries would be accessed
3. **Footprint Generation**: Automatically creates an accurate footprint
4. **Assembly**: Uses the footprint to assemble a proper transaction
5. **Signing & Submission**: You sign and submit as usual

### Benefits:

- **Accuracy**: No more missed or excessive footprint entries
- **Time-saving**: Automatic calculation instead of manual analysis
- **Always up-to-date**: Footprints regenerate with each simulation
- **Optimal concurrency**: Minimal footprints maximize parallel processing
- **Beginner-friendly**: New developers don't need to understand footprint internals

## Before vs After Comparison

### Before (Manual Footprint Management):

```javascript
// Developer must manually specify footprint
const transaction = new StellarSdk.TransactionBuilder(sourceAccount)
  .addOperation(operation)
  // Developer must guess what footprint is needed
  .setFootprint({
    readOnly: [
      // Manually listed - easy to miss entries!
      "contract:GA...:counter",
      "account:GB...",
      // ... potentially many more entries
    ],
    readWrite: ["contract:GA...:counter"],
  })
  .setTimeout(30)
  .build();
```

### After (Using Stellar Footprint Service):

```javascript
// Automatic footprint calculation
const simulateResponse = await fetch(SERVICE_URL + "/simulate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ network: "testnet", operation: "increment_counter" }),
});

const simulateData = await simulateResponse.json();
// Service returns accurate footprint automatically

const assembleResponse = await fetch(SERVICE_URL + "/assemble", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(simulateData),
});

const assembleData = await assembleResponse.json();
// Transaction includes precisely calculated footprint
const transaction = new StellarSdk.Transaction(assembleData.xdr, NETWORK);
// No manual footprint specification needed!
```

## Diagram: Footprint in a Transaction

Here's how a footprint appears within a Stellar transaction:

```
Stellar Transaction Structure:
├── Source Account
├── Fee
├── Sequence Number
├── Timeout
├── Memo
├── Operations (your contract calls)
└── Footprint  <-- Automatically calculated by the service
    ├── ReadOnly: [entries your transaction will only read]
    └── ReadWrite: [entries your transaction will read and modify]
```

编者注: In the actual XDR representation, the footprint is a structure containing two lists:

- `readonly`: Ledger entries the transaction will only read
- `readwrite`: Ledger entries the transaction will both read and modify

## Getting Started

To use the Stellar Footprint Service in your project:

1. **Run the service**: `docker-compose up -d` (or deploy to your preferred environment)
2. **Simulate your transaction**: Send a request to `/simulate` with your operation details
3. **Assemble**: Use the simulation response to assemble via `/assemble`
4. **Sign**: Sign the assembled transaction with your keys
5. **Submit**: Submit the signed transaction to the network

The service handles all footprint calculations automatically, letting you focus on building your contract logic rather than managing low-level ledger access details.

## Interpreting the simulation response

`POST /simulate` preserves the RPC's base64 ledger keys in
`rawFootprint.readOnly` and `rawFootprint.readWrite`. The parsed `footprint` arrays
contain entry objects with `xdr` and `type`. Their keys are deduplicated and sorted
by canonical XDR bytes, and a key requested for both read and write appears only
in `footprint.readWrite`.

Soroban resources belong to the whole transaction, including all its operations.
`extractEnvelopeFootprint` reads this shared footprint from v1 and fee-bump
envelopes, ignoring classic operations. `extractFootprint` also accepts an array
of simulation responses to merge their footprints. The service processes the
complete footprint returned by RPC; supported operation combinations still depend
on the network's protocol rules.

`footprint.breakdown` and `footprintStats.breakdown` expose four storage categories:

| Category           | Ledger keys                                                   |
| ------------------ | ------------------------------------------------------------- |
| `contractCode`     | WASM executable code                                          |
| `contractInstance` | The special contract instance key, including instance storage |
| `persistentData`   | Other persistent contract storage                             |
| `temporaryData`    | Temporary contract storage                                    |

Each category includes `count`, `estimatedSizeBytes`, and its base64 `readOnly`
and `readWrite` arrays. Byte estimates measure serialized ledger keys, including
XDR padding. Stored values are unavailable in a footprint. Classic account and
trustline keys contribute to overall footprint statistics, but not these four
contract storage categories.

For Stellar Asset Contracts, `contractType` is `"sac"` and `isSAC` is `true`.
`assetInfo` contains `{ "code": "XLM" }` for native balances or an asset code and
issuer account for issued assets. SAC recognition verifies the network-specific
asset-derived contract address, or the contract instance's built-in SAC executable.
For contract balances without classic trustlines, the service reads the instance's
`AssetInfo` metadata. Metadata lookup failures leave the footprint usable. With
multiple SACs, inspect `sacContracts` for each asset; top-level `assetInfo` is
included only when one SAC has known asset metadata.

## Reviewing footprint changes

`POST /footprint/diff?format=markdown` accepts the same `before` and `after`
base64 footprint arrays as the JSON endpoint and returns `text/markdown`:

```markdown
| Change Type | Entry Type   | Contract ID / Account | Access Mode |
| ----------- | ------------ | --------------------- | ----------- |
| +           | Account      | G...                  | RO          |
| -           | ContractData | C...                  | RW          |
| modified    | ContractData | C...                  | RO → RW     |
```

An access mode change is one `modified` row. Without `format=markdown`, the JSON
response remains `{ "success": true, "data": { "added": ..., "removed": ..., "unchanged": ... } }`.

## Further reading

- [Footprint Optimization Patterns](./footprint-optimization.md) - Architectural patterns to reduce footprint size and minimize Soroban resource fees
- [API Documentation](../api/README.md) - Complete reference for all endpoints
- [Integration Examples](../examples/) - Code samples in multiple languages
- [Postman Collection](../postman/) - Ready-to-use API testing collection
