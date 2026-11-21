"""Custom exceptions for the Stellar Footprint Engine Python SDK."""

from __future__ import annotations

from typing import Any, Optional


class StellarFootprintError(Exception):
    """Base exception for all SDK errors."""


class ServiceError(StellarFootprintError):
    """
    Raised when the service returns an HTTP error or ``success: false``.

    Attributes
    ----------
    status_code: HTTP status code from the service response.
    body:        Parsed response body (may be ``None`` if parsing failed).
    """

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        body: Optional[Any] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body

    def __repr__(self) -> str:
        return (
            f"ServiceError(message={str(self)!r}, "
            f"status_code={self.status_code!r})"
        )
