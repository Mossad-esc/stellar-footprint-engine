"""
Pydantic data models for the Stellar Footprint Engine Python SDK.

These models mirror the TypeScript interfaces defined in src/types.ts and
src/services/simulator.ts so that callers receive fully-typed objects rather
than raw dictionaries.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────────────────────
# Enumerations
# ──────────────────────────────────────────────────────────────────────────────


class Network(str, Enum):
    """Stellar network identifiers accepted by the service."""

    TESTNET = "testnet"
    MAINNET = "mainnet"
    FUTURENET = "futurenet"


class StorageCategory(str, Enum):
    CONTRACT_CODE = "contractCode"
    CONTRACT_INSTANCE = "contractInstance"
    PERSISTENT_DATA = "persistentData"
    TEMPORARY_DATA = "temporaryData"


class ContractType(str, Enum):
    TOKEN = "token"
    SAC = "sac"
    UNKNOWN = "unknown"


# ──────────────────────────────────────────────────────────────────────────────
# Sub-models
# ──────────────────────────────────────────────────────────────────────────────


class AssetInfo(BaseModel):
    """Stellar classic asset information surfaced for SAC contracts."""

    code: str
    issuer: Optional[str] = None


class TtlInfo(BaseModel):
    """Time-to-live information for a ledger entry."""

    live_until_ledger: Optional[int] = Field(None, alias="liveUntilLedger")
    expires_in_ledgers: Optional[int] = Field(None, alias="expiresInLedgers")
    requires_extension: Optional[bool] = Field(None, alias="requiresExtension")
    requires_restore: Optional[bool] = Field(None, alias="requiresRestore")

    model_config = {"populate_by_name": True}


class TtlExtensionRecommendation(BaseModel):
    """Suggested TTL extension for entries approaching expiry."""

    extend_to: int = Field(..., alias="extendTo")
    entries: List[str]
    restore_first: bool = Field(..., alias="restoreFirst")

    model_config = {"populate_by_name": True}


class StorageStats(BaseModel):
    count: int
    estimated_size_bytes: int = Field(..., alias="estimatedSizeBytes")
    read_only: List[str] = Field(..., alias="readOnly")
    read_write: List[str] = Field(..., alias="readWrite")

    model_config = {"populate_by_name": True}


class FootprintBreakdown(BaseModel):
    contract_code: Optional[StorageStats] = Field(None, alias="contractCode")
    contract_instance: Optional[StorageStats] = Field(None, alias="contractInstance")
    persistent_data: Optional[StorageStats] = Field(None, alias="persistentData")
    temporary_data: Optional[StorageStats] = Field(None, alias="temporaryData")

    model_config = {"populate_by_name": True}


class FootprintStats(BaseModel):
    read_only_count: int = Field(..., alias="readOnlyCount")
    read_write_count: int = Field(..., alias="readWriteCount")
    total_entries: int = Field(..., alias="totalEntries")
    read_only_size_bytes: int = Field(..., alias="readOnlySizeBytes")
    read_write_size_bytes: int = Field(..., alias="readWriteSizeBytes")
    estimated_size_bytes: int = Field(..., alias="estimatedSizeBytes")
    is_sac: bool = Field(..., alias="isSAC")
    asset_info: Optional[AssetInfo] = Field(None, alias="assetInfo")
    breakdown: Optional[FootprintBreakdown] = None

    model_config = {"populate_by_name": True}


class FootprintEntry(BaseModel):
    """A single ledger key in a transaction footprint."""

    xdr: str
    type: Optional[str] = None
    contract_id: Optional[str] = Field(None, alias="contractId")
    ttl_info: Optional[TtlInfo] = Field(None, alias="ttlInfo")

    model_config = {"populate_by_name": True}


class Footprint(BaseModel):
    read_only: List[FootprintEntry] = Field(default_factory=list, alias="readOnly")
    read_write: List[FootprintEntry] = Field(default_factory=list, alias="readWrite")
    breakdown: Optional[FootprintBreakdown] = None

    model_config = {"populate_by_name": True}


class ContractInvocation(BaseModel):
    contract_id: str = Field(..., alias="contractId")
    is_contract_creation: Optional[bool] = Field(None, alias="isContractCreation")
    function_name: str = Field(..., alias="functionName")
    args: List[str]
    arg_types: Optional[List[str]] = Field(None, alias="argTypes")

    model_config = {"populate_by_name": True}


class AuthEntry(BaseModel):
    contract_id: str = Field(..., alias="contractId")
    function_name: str = Field(..., alias="functionName")
    xdr: str
    authorizer: Optional[str] = None
    credentials_type: Optional[str] = Field(None, alias="credentialsType")

    model_config = {"populate_by_name": True}


class ContractEvent(BaseModel):
    type: str
    contract_id: str = Field(..., alias="contractId")
    topics: List[str]
    data: str

    model_config = {"populate_by_name": True}


class SimulationCost(BaseModel):
    cpu_insns: str = Field(..., alias="cpuInsns")
    mem_bytes: str = Field(..., alias="memBytes")
    ttl_extension: Optional[TtlExtensionRecommendation] = Field(None, alias="ttlExtension")

    model_config = {"populate_by_name": True}


class SacContract(BaseModel):
    contract_id: str = Field(..., alias="contractId")
    is_sac: bool = Field(True, alias="isSAC")
    asset_info: Optional[AssetInfo] = Field(None, alias="assetInfo")

    model_config = {"populate_by_name": True}


# ──────────────────────────────────────────────────────────────────────────────
# Primary result types
# ──────────────────────────────────────────────────────────────────────────────


class SimulationResult(BaseModel):
    """
    Full simulation result returned by ``POST /api/v1/simulate``.

    Every field is optional because the service may omit them on failure or
    when they are not relevant to the transaction type.
    """

    success: bool
    simulated_at: Optional[str] = Field(None, alias="simulatedAt")
    footprint: Optional[Footprint] = None
    contracts: Optional[List[str]] = None
    contract_type: Optional[ContractType] = Field(None, alias="contractType")
    is_sac: Optional[bool] = Field(None, alias="isSAC")
    asset_info: Optional[AssetInfo] = Field(None, alias="assetInfo")
    sac_contracts: Optional[List[SacContract]] = Field(None, alias="sacContracts")
    ttl: Optional[Dict[str, TtlInfo]] = None
    ttl_warnings: Optional[List[str]] = Field(None, alias="ttlWarnings")
    optimized: Optional[bool] = None
    footprint_stats: Optional[FootprintStats] = Field(None, alias="footprintStats")
    invocation: Optional[ContractInvocation] = None
    auth_entries: Optional[List[AuthEntry]] = Field(None, alias="authEntries")
    events: Optional[List[ContractEvent]] = None
    cost: Optional[SimulationCost] = None
    resource_fee: Optional[str] = Field(None, alias="resourceFee")
    error: Optional[str] = None
    contract_id: Optional[str] = Field(None, alias="contractId")
    required_signers: Optional[List[str]] = Field(None, alias="requiredSigners")
    threshold: Optional[int] = None
    cache_hit: Optional[bool] = Field(None, alias="cacheHit")
    warnings: Optional[List[str]] = None

    model_config = {"populate_by_name": True}


class FeeBreakdownDetail(BaseModel):
    base_fee: str = Field(..., alias="baseFee")
    write_fee: str = Field(..., alias="writeFee")
    refundable_fee: str = Field(..., alias="refundableFee")
    other_resource_fee: str = Field(..., alias="otherResourceFee")

    model_config = {"populate_by_name": True}


class FeeEstimate(BaseModel):
    """
    Fee estimate returned by ``POST /api/v1/estimate-fee`` or the
    ``GET /api/v1/simulate/cost-breakdown`` endpoint.
    """

    base_fee: str = Field(..., alias="baseFee")
    resource_fee: str = Field(..., alias="resourceFee")
    total_fee: str = Field(..., alias="totalFee")
    fee_in_xlm: str = Field(..., alias="feeInXLM")
    operation_type: Optional[str] = Field(None, alias="operationType")
    breakdown: Optional[FeeBreakdownDetail] = None

    model_config = {"populate_by_name": True}


class FootprintDiff(BaseModel):
    """
    Result of comparing two transaction footprints via
    ``POST /api/v1/footprint/diff``.
    """

    added: Optional[Footprint] = None
    removed: Optional[Footprint] = None
    moved: Optional[Dict[str, List[FootprintEntry]]] = None
    unchanged: Optional[Footprint] = None


class ServiceResponse(BaseModel):
    """
    Envelope wrapping all API responses:
    ``{ success: bool, data?: T, error?: string }``
    """

    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None


# Re-export for convenience
__all__ = [
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
    "ServiceResponse",
]
