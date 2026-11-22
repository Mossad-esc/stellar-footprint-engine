# Python Integration Examples

Two integration styles are shown below: a one-file scripted example using the `requests` library (useful for quick prototyping), and the preferred approach using the official **`stellar-footprint`** Python SDK.

---

## Option A — Official Python SDK (`stellar-footprint`)

Install from PyPI:

```bash
pip install stellar-footprint
```

### Synchronous client

```python
from stellar_footprint import StellarFootprintClient, Network
from stellar_footprint.exceptions import ServiceError

SERVICE_URL = "http://localhost:3000"

with StellarFootprintClient(
    base_url=SERVICE_URL,
    api_key="your-api-key",   # omit if the service has no API key
    network=Network.TESTNET,
) as client:
    # Simulate a Soroban transaction
    result = client.simulate(xdr="<base64 XDR>")

    if result.success:
        stats = result.footprint_stats
        print(f"Footprint entries : {stats.total_entries}")
        print(f"Estimated size    : {stats.estimated_size_bytes} bytes")

        cost = result.cost
        print(f"CPU instructions  : {cost.cpu_insns}")
        print(f"Memory bytes      : {cost.mem_bytes}")
        print(f"Resource fee      : {result.resource_fee} stroops")

    # Detailed fee breakdown
    fee = client.estimate_fee(
        cpu_insns=result.cost.cpu_insns,
        mem_bytes=result.cost.mem_bytes,
    )
    print(f"Total fee : {fee.total_fee} stroops ({fee.fee_in_xlm} XLM)")

    # Decode an XDR to JSON
    decoded = client.decode(xdr="<base64 XDR>")
    print(decoded)

    # Compare two transaction footprints
    diff = client.diff(xdr1="<XDR 1>", xdr2="<XDR 2>")
    added = (len(diff.added.read_only) + len(diff.added.read_write)) if diff.added else 0
    print(f"Footprint entries added: {added}")
```

### Asynchronous client (asyncio)

```python
import asyncio
from stellar_footprint import AsyncStellarFootprintClient, Network

async def main() -> None:
    async with AsyncStellarFootprintClient(
        base_url="http://localhost:3000",
        network=Network.TESTNET,
    ) as client:
        result = await client.simulate(xdr="<base64 XDR>")
        fee = await client.estimate_fee(
            cpu_insns=result.cost.cpu_insns,
            mem_bytes=result.cost.mem_bytes,
        )
        print(f"Fee: {fee.fee_in_xlm} XLM")

asyncio.run(main())
```

### Error handling

```python
from stellar_footprint.exceptions import ServiceError, StellarFootprintError

try:
    result = client.simulate(xdr="invalid-xdr")
except ServiceError as e:
    # HTTP 4xx/5xx or success=false from the service
    print(f"Service returned {e.status_code}: {e}")
except StellarFootprintError as e:
    # Network / connection errors
    print(f"Could not reach service: {e}")
```

---

## Option B — Raw `requests` (scripting / no SDK)

This demonstrates the full simulate → assemble → sign → submit flow using the
`requests` and `stellar-sdk` libraries directly.

### Prerequisites

```bash
pip install requests stellar-sdk
```

A funded Stellar testnet account is required. Use [Friendbot](https://laboratory.stellar.org/#account-creator?network=test) to fund one.

### Code

```python
import requests
from stellar_sdk import Keypair, TransactionEnvelope, Networks

SERVICE_URL = "http://localhost:3000"
NETWORK = Networks.TESTNET

source_keypair = Keypair.from_secret("YOUR_TESTNET_SECRET_SEED")

def main() -> None:
    headers = {"Content-Type": "application/json"}

    # Step 1: Simulate
    print("Step 1: Simulating transaction…")
    sim_resp = requests.post(
        f"{SERVICE_URL}/api/v1/simulate",
        json={"xdr": "<base64 XDR>", "network": "testnet"},
        headers=headers,
        timeout=30,
    )
    sim_resp.raise_for_status()
    sim_data = sim_resp.json()["data"]
    print(f"  CPU insns   : {sim_data['cost']['cpuInsns']}")
    print(f"  Memory bytes: {sim_data['cost']['memBytes']}")

    # Step 2: Sign
    print("Step 2: Signing transaction…")
    tx = TransactionEnvelope.from_xdr(sim_data["rawXdr"], NETWORK)
    tx.sign(source_keypair)
    signed_xdr = tx.to_xdr()
    print("  Transaction signed")

    # Step 3: Submit (via Horizon or your own submit endpoint)
    print("Step 3: Done — submit signed_xdr to Horizon or your submit endpoint")
    print(f"  Signed XDR: {signed_xdr[:60]}…")

if __name__ == "__main__":
    main()
```

### Expected output

```
Step 1: Simulating transaction…
  CPU insns   : 1000000
  Memory bytes: 204800
Step 2: Signing transaction…
  Transaction signed
Step 3: Done — submit signed_xdr to Horizon or your submit endpoint
  Signed XDR: AAAAAQ…
```
