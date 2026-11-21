"""
stellar-footprint — Python SDK for the Stellar Footprint Engine service.

Quick start
-----------

Synchronous::

    from stellar_footprint import StellarFootprintClient, Network

    with StellarFootprintClient(base_url="http://localhost:3000") as client:
        result = client.simulate(xdr="<your XDR>", network=Network.TESTNET)
        print(result.cost)

Asynchronous::

    import asyncio
    from stellar_footprint import AsyncStellarFootprintClient, Network

    async def main():
        async with AsyncStellarFootprintClient() as client:
            result = await client.simulate(xdr="<your XDR>")
            print(result.footprint_stats)

    asyncio.run(main())
"""

from .async_client import AsyncStellarFootprintClient
from .client import StellarFootprintClient
from .exceptions import ServiceError, StellarFootprintError
from .models import (
    AssetInfo,
    AuthEntry,
    ContractEvent,
    ContractInvocation,
    ContractType,
    FeeBreakdownDetail,
    FeeEstimate,
    Footprint,
    FootprintBreakdown,
    FootprintDiff,
    FootprintEntry,
    FootprintStats,
    Network,
    SacContract,
    SimulationCost,
    SimulationResult,
    StorageCategory,
    StorageStats,
    TtlExtensionRecommendation,
    TtlInfo,
)

__version__ = "1.0.0"

__all__ = [
    # Clients
    "StellarFootprintClient",
    "AsyncStellarFootprintClient",
    # Exceptions
    "StellarFootprintError",
    "ServiceError",
    # Models
    "Network",
    "StorageCategory",
    "ContractType",
    "AssetInfo",
    "TtlInfo",
    "TtlExtensionRecommendation",
    "StorageStats",
    "FootprintBreakdown",
    "FootprintStats",
    "FootprintEntry",
    "Footprint",
    "ContractInvocation",
    "AuthEntry",
    "ContractEvent",
    "SimulationCost",
    "SacContract",
    "SimulationResult",
    "FeeBreakdownDetail",
    "FeeEstimate",
    "FootprintDiff",
]
