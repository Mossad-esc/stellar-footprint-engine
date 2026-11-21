"""
Asynchronous (asyncio) HTTP client for the Stellar Footprint Engine service.

Usage::

    import asyncio
    from stellar_footprint import AsyncStellarFootprintClient, Network

    async def main():
        async with AsyncStellarFootprintClient(
            base_url="http://localhost:3000",
            network=Network.TESTNET,
        ) as client:
            result = await client.simulate(xdr="AAA...")
            print(result.cost.cpu_insns)

    asyncio.run(main())
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import httpx

from .exceptions import StellarFootprintError, ServiceError
from .models import (
    FeeEstimate,
    FootprintDiff,
    Network,
    SimulationResult,
)


class AsyncStellarFootprintClient:
    """
    Async-safe client backed by ``httpx.AsyncClient``.

    Use as an async context manager or call :meth:`aclose` explicitly.

    Parameters
    ----------
    base_url:
        Base URL of the running service.
        Defaults to ``SFE_BASE_URL`` env var or ``http://localhost:3000``.
    api_key:
        Value forwarded as the ``x-api-key`` header.
        Defaults to the ``SFE_API_KEY`` env var if set.
    network:
        Default network for requests that accept one (default: testnet).
    timeout:
        Per-request timeout in seconds (default 30).
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        network: Network = Network.TESTNET,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = (
            base_url
            or os.environ.get("SFE_BASE_URL", "http://localhost:3000")
        ).rstrip("/")
        self._api_key = api_key or os.environ.get("SFE_API_KEY")
        self.network = network
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=timeout,
            headers=self._build_headers(),
        )

    # ──────────────────────────────────────────────────────────────────────────
    # Async context manager
    # ──────────────────────────────────────────────────────────────────────────

    async def __aenter__(self) -> "AsyncStellarFootprintClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        """Release the underlying connection pool."""
        await self._client.aclose()

    # ──────────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────────

    async def simulate(
        self,
        xdr: str,
        network: Optional[Network] = None,
    ) -> SimulationResult:
        """
        Simulate a Soroban transaction XDR asynchronously.

        Parameters
        ----------
        xdr:    Base64-encoded Soroban transaction XDR envelope.
        network: Network override (defaults to the client's ``network``).
        """
        payload: Dict[str, Any] = {
            "xdr": xdr,
            "network": (network or self.network).value,
        }
        data = await self._post("/api/v1/simulate", payload)
        return SimulationResult.model_validate(data)

    async def estimate_fee(
        self,
        cpu_insns: str,
        mem_bytes: str,
        network: Optional[Network] = None,
        operation_type: Optional[str] = None,
    ) -> FeeEstimate:
        """
        Request a fee estimate given known resource costs.
        """
        payload: Dict[str, Any] = {
            "cpuInsns": cpu_insns,
            "memBytes": mem_bytes,
            "network": (network or self.network).value,
        }
        if operation_type:
            payload["operationType"] = operation_type
        data = await self._post("/api/v1/estimate-fee", payload)
        return FeeEstimate.model_validate(data)

    async def cost_breakdown(
        self,
        cpu_insns: str,
        mem_bytes: str,
        network: Optional[Network] = None,
    ) -> FeeEstimate:
        """
        Fetch the detailed fee/cost breakdown via the GET endpoint.
        """
        net = (network or self.network).value
        params = {"cpuInsns": cpu_insns, "memBytes": mem_bytes, "network": net}
        data = await self._get("/api/v1/simulate/cost-breakdown", params)
        return FeeEstimate.model_validate(data)

    async def decode(self, xdr: str, xdr_type: str = "TransactionEnvelope") -> Any:
        """
        Decode an XDR string to a human-readable Python dict.
        """
        params = {"xdr": xdr, "type": xdr_type}
        return await self._get("/api/v1/decode", params)

    async def diff(
        self,
        xdr1: str,
        xdr2: str,
        network: Optional[Network] = None,
    ) -> FootprintDiff:
        """
        Compare the footprints of two transaction XDR strings.
        """
        payload: Dict[str, Any] = {
            "xdr1": xdr1,
            "xdr2": xdr2,
            "network": (network or self.network).value,
        }
        data = await self._post("/api/v1/footprint/diff", payload)
        return FootprintDiff.model_validate(data)

    async def health(self) -> Dict[str, Any]:
        """Return the service health status."""
        try:
            resp = await self._client.get("/api/v1/health")
        except httpx.RequestError as exc:
            raise StellarFootprintError(f"HTTP request failed: {exc}") from exc
        resp.raise_for_status()
        return resp.json()  # type: ignore[no-any-return]

    # ──────────────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _build_headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["x-api-key"] = self._api_key
        return headers

    async def _post(self, path: str, payload: Dict[str, Any]) -> Any:
        try:
            resp = await self._client.post(path, json=payload)
        except httpx.RequestError as exc:
            raise StellarFootprintError(f"HTTP request failed: {exc}") from exc
        return self._unwrap(resp)

    async def _get(self, path: str, params: Dict[str, str]) -> Any:
        try:
            resp = await self._client.get(path, params=params)
        except httpx.RequestError as exc:
            raise StellarFootprintError(f"HTTP request failed: {exc}") from exc
        return self._unwrap(resp)

    @staticmethod
    def _unwrap(resp: httpx.Response) -> Any:
        try:
            body = resp.json()
        except Exception as exc:
            raise StellarFootprintError(
                f"Non-JSON response ({resp.status_code}): {resp.text[:200]}"
            ) from exc

        if resp.status_code >= 400:
            error_msg = (
                body.get("error")
                or body.get("message")
                or f"HTTP {resp.status_code}"
            ) if isinstance(body, dict) else f"HTTP {resp.status_code}"
            raise ServiceError(error_msg, status_code=resp.status_code, body=body)

        if isinstance(body, dict) and "data" in body:
            if not body.get("success", True):
                raise ServiceError(
                    body.get("error") or "Service returned success=false",
                    status_code=resp.status_code,
                    body=body,
                )
            return body["data"]

        return body
