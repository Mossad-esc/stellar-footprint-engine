# stellar-footprint

Official Python SDK for the [Stellar Footprint Engine](https://github.com/Mossad-esc/stellar-footprint-engine) — simulate, diff, decode, and cost Soroban transactions.

## Installation

```bash
pip install stellar-footprint
```

## Quick Start

### Synchronous

```python
from stellar_footprint import StellarFootprintClient, Network

with StellarFootprintClient(
    base_url="http://localhost:3000",
    api_key="your-api-key",          # optional
    network=Network.TESTNET,
) as client:
    result = client.simulate(xdr="<base64 XDR>")
    print(f"CPU instructions : {result.cost.cpu_insns}")
    print(f"Memory bytes     : {result.cost.mem_bytes}")
    print(f"Resource fee     : {result.resource_fee} stroops")
    print(f"Footprint entries: {result.footprint_stats.total_entries}")
```

### Asynchronous

```python
import asyncio
from stellar_footprint import AsyncStellarFootprintClient, Network

async def main():
    async with AsyncStellarFootprintClient(
        base_url="http://localhost:3000",
        network=Network.TESTNET,
    ) as client:
        result = await client.simulate(xdr="<base64 XDR>")
        print(result.footprint_stats)

asyncio.run(main())
```

## Configuration

| Parameter  | Env variable    | Default                    |
|------------|-----------------|----------------------------|
| `base_url` | `SFE_BASE_URL`  | `http://localhost:3000`    |
| `api_key`  | `SFE_API_KEY`   | *(none)*                   |
| `network`  | —               | `Network.TESTNET`          |
| `timeout`  | —               | `30.0` seconds             |

## Available Methods

Both `StellarFootprintClient` and `AsyncStellarFootprintClient` expose the same interface (async variants use `await`):

| Method | Endpoint | Returns |
|--------|----------|---------|
| `simulate(xdr, network?)` | `POST /api/v1/simulate` | `SimulationResult` |
| `estimate_fee(cpu_insns, mem_bytes, network?, operation_type?)` | `POST /api/v1/estimate-fee` | `FeeEstimate` |
| `cost_breakdown(cpu_insns, mem_bytes, network?)` | `GET /api/v1/simulate/cost-breakdown` | `FeeEstimate` |
| `decode(xdr, xdr_type?)` | `GET /api/v1/decode` | `dict` |
| `diff(xdr1, xdr2, network?)` | `POST /api/v1/footprint/diff` | `FootprintDiff` |
| `health()` | `GET /api/v1/health` | `dict` |

## Error Handling

```python
from stellar_footprint.exceptions import ServiceError, StellarFootprintError

try:
    result = client.simulate(xdr="invalid")
except ServiceError as e:
    print(f"Service error {e.status_code}: {e}")
except StellarFootprintError as e:
    print(f"SDK error: {e}")
```

## Development

```bash
# Install with dev extras
pip install -e "packages/python-sdk[dev]"

# Run tests
pytest packages/python-sdk
```

## License

MIT
