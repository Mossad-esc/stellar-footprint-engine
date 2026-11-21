"""
Unit tests for AsyncStellarFootprintClient.

All HTTP calls are intercepted with respx so no live service is required.
pytest-asyncio's auto mode is configured in pyproject.toml so coroutine tests
run without additional decorators.
"""

import pytest
import respx
import httpx

from stellar_footprint import AsyncStellarFootprintClient, Network
from stellar_footprint.exceptions import ServiceError, StellarFootprintError
from stellar_footprint.models import SimulationResult, FeeEstimate, FootprintDiff


BASE = "http://localhost:3000"

SIMULATE_RESPONSE = {
    "success": True,
    "data": {
        "success": True,
        "simulatedAt": "2026-11-21T14:00:00.000Z",
        "footprint": {
            "readOnly": [{"xdr": "AAAA", "type": "ContractCode", "contractId": "abc123"}],
            "readWrite": [{"xdr": "BBBB", "type": "ContractData", "contractId": "abc123"}],
        },
        "footprintStats": {
            "readOnlyCount": 1,
            "readWriteCount": 1,
            "totalEntries": 2,
            "readOnlySizeBytes": 44,
            "readWriteSizeBytes": 44,
            "estimatedSizeBytes": 88,
            "isSAC": False,
        },
        "cost": {"cpuInsns": "1000000", "memBytes": "204800"},
        "resourceFee": "5000",
        "contracts": ["abc123"],
    },
}

FEE_RESPONSE = {
    "success": True,
    "data": {
        "baseFee": "100",
        "resourceFee": "4900",
        "totalFee": "5000",
        "feeInXLM": "0.0005000",
        "breakdown": {
            "baseFee": "100",
            "writeFee": "2000",
            "refundableFee": "1000",
            "otherResourceFee": "1900",
        },
    },
}

DIFF_RESPONSE = {
    "success": True,
    "data": {
        "added": {
            "readOnly": [{"xdr": "CCCC", "type": "ContractCode"}],
            "readWrite": [],
        },
        "removed": {"readOnly": [], "readWrite": []},
        "moved": {"toReadOnly": [], "toReadWrite": []},
        "unchanged": {"readOnly": [], "readWrite": []},
    },
}


@respx.mock
async def test_async_simulate_returns_simulation_result():
    respx.post(f"{BASE}/api/v1/simulate").mock(
        return_value=httpx.Response(200, json=SIMULATE_RESPONSE)
    )

    async with AsyncStellarFootprintClient(base_url=BASE) as client:
        result = await client.simulate(xdr="AAABBB", network=Network.TESTNET)

    assert isinstance(result, SimulationResult)
    assert result.success is True
    assert result.cost.cpu_insns == "1000000"
    assert result.footprint_stats.total_entries == 2


@respx.mock
async def test_async_simulate_raises_service_error():
    respx.post(f"{BASE}/api/v1/simulate").mock(
        return_value=httpx.Response(400, json={"success": False, "error": "Bad XDR"})
    )

    async with AsyncStellarFootprintClient(base_url=BASE) as client:
        with pytest.raises(ServiceError) as exc_info:
            await client.simulate(xdr="BAD")

    assert "Bad XDR" in str(exc_info.value)


@respx.mock
async def test_async_simulate_raises_on_connection_error():
    respx.post(f"{BASE}/api/v1/simulate").mock(
        side_effect=httpx.ConnectError("refused")
    )

    async with AsyncStellarFootprintClient(base_url=BASE) as client:
        with pytest.raises(StellarFootprintError):
            await client.simulate(xdr="AAABBB")


@respx.mock
async def test_async_estimate_fee():
    respx.post(f"{BASE}/api/v1/estimate-fee").mock(
        return_value=httpx.Response(200, json=FEE_RESPONSE)
    )

    async with AsyncStellarFootprintClient(base_url=BASE) as client:
        fee = await client.estimate_fee(cpu_insns="1000000", mem_bytes="204800")

    assert isinstance(fee, FeeEstimate)
    assert fee.total_fee == "5000"


@respx.mock
async def test_async_diff():
    respx.post(f"{BASE}/api/v1/footprint/diff").mock(
        return_value=httpx.Response(200, json=DIFF_RESPONSE)
    )

    async with AsyncStellarFootprintClient(base_url=BASE) as client:
        diff = await client.diff(xdr1="AAABBB", xdr2="CCCDDD")

    assert isinstance(diff, FootprintDiff)
    assert len(diff.added.read_only) == 1


@respx.mock
async def test_async_api_key_forwarded():
    route = respx.post(f"{BASE}/api/v1/simulate").mock(
        return_value=httpx.Response(200, json=SIMULATE_RESPONSE)
    )

    async with AsyncStellarFootprintClient(base_url=BASE, api_key="async-key") as client:
        await client.simulate(xdr="AAABBB")

    assert route.called
    request = route.calls[0].request
    assert request.headers.get("x-api-key") == "async-key"
