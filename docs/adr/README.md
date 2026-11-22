# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the Stellar Footprint Service.

## List of ADRs

- [ADR 001: Caching Strategy](./001-caching-strategy.md) - Documents the decision to use in-memory LRU cache with optional Redis backend
- [ADR 002: Circuit Breaker](./002-circuit-breaker.md) - Documents the three-state circuit breaker wrapping outbound RPC calls
- [ADR 003: Rate Limiting Strategy](./003-rate-limiting.md) - Documents the two-layer rate limiting design (express-rate-limit + brute force protection)
- [ADR 004: Async Webhook System Architecture](./004-async-webhook-architecture.md) - Documents the in-process async webhook job tracker, at-least-once delivery retries, and HMAC-SHA256 signing

## What is an ADR?

An Architecture Decision Record (ADR) is a document that captures an important architectural decision made along with its context and consequences.

For more information, see [Michael Nygard's article](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions).
