# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2025-01-01

### Added

- `POST /api/simulate` endpoint — accepts base64-encoded transaction XDR and returns optimized footprint and resource costs
- Stellar Soroban transaction simulation via `@stellar/stellar-sdk`
- Footprint extraction: parses `read_only` and `read_write` ledger keys from simulation results
- Footprint optimization — removes unnecessary ledger entries from the footprint
- Resource cost estimation — returns `cpuInsns` and `memBytes` from simulation response
- Support for both `testnet` and `mainnet` networks via request body `network` field
- XDR parsing and decoding utilities
- Redis-backed response caching for identical XDR inputs
- Prometheus metrics middleware (`/metrics` endpoint)
- Request timeout middleware with configurable `SIMULATE_TIMEOUT_MS`
- Rate limiting middleware with configurable thresholds
- Brute-force protection middleware with IP-level delay and blocking
- IP allowlist and blocklist middleware via `IP_ALLOWLIST` / `IP_BLOCKLIST` env vars
- Circuit breaker for RPC calls with configurable failure threshold and recovery window
- Request logging middleware
- Response time tracking middleware
- Content-type validation middleware
- Graceful error handling with structured JSON error responses
- Health check endpoint (`/health`) and `healthcheck.js` script for Docker
- Docker support: `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml`
- Nginx reverse proxy configuration with TLS support
- PM2 process manager configuration via `ecosystem.config.js`
- Grafana dashboard and Prometheus scrape configuration under `monitoring/`
- Conventional Commits enforcement via `commitlint` and Husky pre-commit/pre-push hooks
- Branch name validation via `validate-branch-name`
- ESLint and Prettier configuration for consistent code style
- TypeScript strict mode with `tsconfig.json`
- Jest test suite with unit, integration, and smoke tests
- Load testing script via `autocannon` (`scripts/load-test.js`)
- Environment variable reference in `.env.example`
- Deployment guide for Railway, Render, Fly.io, and bare VPS with PM2 (`docs/deployment.md`)
- Postman collection for API testing (`docs/postman/`)
- Architecture Decision Record for caching strategy (`docs/adr/001-caching-strategy.md`)
- Contributor guide (`CONTRIBUTING.md`)

### Security

- Secret keys are never logged or returned in API responses
- IP-level brute-force blocking to prevent abuse
- Configurable IP allowlist to restrict access to trusted clients
- Circuit breaker prevents cascading failures from RPC outages

[Unreleased]: https://github.com/Mossad-esc/stellar-footprint-engine/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Mossad-esc/stellar-footprint-engine/releases/tag/v1.0.0
