"""
Unit tests for StellarFootprintClient (synchronous).

All HTTP calls are intercepted with respx so no live service is required.
"""

import pytest
import respx
import httpx

from stellar_footprint import StellarFootprintClient, Network
from stellar_footprint.exceptions import ServiceError, StellarFootprintError
from stellar_footprint.models import SimulationResult, FeeEstimate, FootprintDiff


BASE = "http://localhost:3000"

# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

SIMULATE_RESPONSE = {
    "success": True,
    "data": {
        "success": True,
        "simulatedAt": "2026-11-21T14:00:00.000Z",
        "footprint": {
            "readOnly": [
                {"xdr": "AAAA", "type": "ContractCode", "contractId": "abc123"},
            ],
            "readWrite": [
                {"xdr": "BBBB", "type": "ContractData", "contractId": "abc123"},
            ],
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
        "cost": {
            "cpuInsns": "1000000",
            "memBytes": "204800",
        },
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
        "operationType": "invoke",
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

DECODE_RESPONSE = {
    "success": True,
    "data": {"type": "TransactionEnvelope", "tx": {"fee": 100}},
}


# ─────────────────────────────────────────────────────────────────────────────
# simulate
# ─────────────────────────────────────────────────────────────────────────────


@respx.mock
def test_simulate_returns_simulation_result():
    respx.post(f"{BASE}/api/v1/simulate").mock(
        return_value=httpx.Response(200, json=SIMULATE_RESPONSE)
    )

    with StellarFootprintClient(base_url=BASE) as client:
        result = client.simulate(xdr="AAABBB", network=Network.TESTNET)

    assert isinstance(result, SimulationResult)
    assert result.success is True
    assert result.cost is not None
    assert result.cost.cpu_insns == "1000000"
    assert result.footprint_stats is not None
    assert result.footprint_stats.total_entries == 2


@respx.mock
def test_simulate_raises_service_error_on_failure():
    respx.post(f"{BASE}/api/v1/simulate").mock(
        return_value=httpx.Response(400, json={"success": False, "error": "Invalid XDR"})
    )

    with StellarFootprintClient(base_url=BASE) as client:
        with pytest.raises(ServiceError) as exc_info:
            client.simulate(xdr="BAD")

    assert "Invalid XDR" in str(exc_info.value)


@respx.mock
def test_simulate_raises_on_connection_error():
    respx.post(f"{BASE}/api/v1/simulate").mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    with StellarFootprintClient(base_url=BASE) as client:
        with pytest.raises(StellarFootprintError):
            client.simulate(xdr="AAABBB")


# ─────────────────────────────────────────────────────────────────────────────
# estimate_fee
# ─────────────────────────────────────────────────────────────────────────────


@respx.mock
def test_estimate_fee_returns_fee_estimate():
    respx.post(f"{BASE}/api/v1/estimate-fee").mock(
        return_value=httpx.Response(200, json=FEE_RESPONSE)
    )

    with StellarFootprintClient(base_url=BASE) as client:
        fee = client.estimate_fee(cpu_insns="1000000", mem_bytes="204800")

    assert isinstance(fee, FeeEstimate)
    assert fee.total_fee == "5000"
    assert fee.fee_in_xlm == "0.0005000"
    assert fee.breakdown is not None
    assert fee.breakdown.write_fee == "2000"


# ─────────────────────────────────────────────────────────────────────────────
# diff
# ─────────────────────────────────────────────────────────────────────────────


@respx.mock
def test_diff_returns_footprint_diff():
    respx.post(f"{BASE}/api/v1/footprint/diff").mock(
        return_value=httpx.Response(200, json=DIFF_RESPONSE)
    )

    with StellarFootprintClient(base_url=BASE) as client:
        diff = client.diff(xdr1="AAABBB", xdr2="CCCDDD")

    assert isinstance(diff, FootprintDiff)
    assert diff.added is not None
    assert len(diff.added.read_only) == 1


# ─────────────────────────────────────────────────────────────────────────────
# decode
# ─────────────────────────────────────────────────────────────────────────────


@respx.mock
def test_decode_returns_dict():
    respx.get(f"{BASE}/api/v1/decode").mock(
        return_value=httpx.Response(200, json=DECODE_RESPONSE)
    )

    with StellarFootprintClient(base_url=BASE) as client:
        decoded = client.decode(xdr="AAABBB")

    assert isinstance(decoded, dict)
    assert decoded["type"] == "TransactionEnvelope"


# ─────────────────────────────────────────────────────────────────────────────
# API-key forwarding
# ─────────────────────────────────────────────────────────────────────────────


@respx.mock
def test_api_key_forwarded_in_header():
    route = respx.post(f"{BASE}/api/v1/simulate").mock(
        return_value=httpx.Response(200, json=SIMULATE_RESPONSE)
    )

    with StellarFootprintClient(base_url=BASE, api_key="secret-key") as client:
        client.simulate(xdr="AAABBB")

    assert route.called
    request = route.calls[0].request
    assert request.headers.get("x-api-key") == "secret-key"
