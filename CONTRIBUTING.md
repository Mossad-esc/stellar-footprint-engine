# Contributing to Stellar Footprint Service

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Table of Contents

- [Fork and Clone](#fork-and-clone)
- [Local Development Setup](#local-development-setup)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Commit Message Format](#commit-message-format)
- [Pull Request Process](#pull-request-process)
- [Issue Labels](#issue-labels)

---

## Fork and Clone

1. **Fork** the repository by clicking the **Fork** button on [GitHub](https://github.com/Dafuriousis/Stellar-Footprint-Service).

2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/Stellar-Footprint-Service.git
   cd Stellar-Footprint-Service
   ```

3. **Add the upstream remote** so you can pull in future changes:
   ```bash
   git remote add upstream https://github.com/Dafuriousis/Stellar-Footprint-Service.git
   ```

4. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

---

## Local Development Setup

### Prerequisites

- Node.js >= 22
- pnpm (preferred) or npm
- Git

### Steps

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your RPC URLs and settings
   ```

3. **Build the project:**

   ```bash
   pnpm run build
   ```

4. **Start the development server:**
   ```bash
   pnpm run dev
   ```

5. **Run tests:**
   ```bash
   pnpm test
   ```

### Available Scripts

| Script | Description |
|---|---|
| `pnpm run dev` | Start dev server with hot reload |
| `pnpm run build` | Compile TypeScript |
| `pnpm run typecheck` | Run TypeScript type checking without emitting files |
| `pnpm run start` | Start production server |
| `pnpm run lint` | Run ESLint |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run format` | Format code with Prettier |
| `pnpm run format:check` | Check formatting without writing |
| `pnpm test` | Run test suite |
| `pnpm test --updateSnapshot` | Refresh Jest snapshots after intentional response shape changes |

### Updating Jest snapshots

Snapshot coverage in this repository is maintained through Jest snapshots. When an endpoint response shape intentionally changes, refresh the snapshots with:

```bash
pnpm test --updateSnapshot
```

This updates inline snapshots and generated snapshot files in place. Review the updated snapshot blocks before committing.

---

## Running Tests

### Basic Commands

**Run the full test suite:**
```bash
pnpm test
```

**Run tests with coverage report:**
```bash
pnpm run test:coverage
```
This generates a coverage report showing which lines of code are tested. Aim for high coverage on critical services like `feeEstimator.ts`, `footprintExtractor.ts`, and `simulator.ts`.

**Run a single test file:**
```bash
pnpm test -- src/__tests__/features.test.ts
```
Or with coverage for a specific file:
```bash
pnpm test -- --coverage src/__tests__/features.test.ts
```

### Integration Tests

Integration tests require Redis to be running. You can start Redis using Docker Compose:

```bash
docker compose -f docker-compose.test.yml up -d
```

Then run the integration tests:

```bash
pnpm test:integration
```

Alternatively, you can run integration tests manually with Redis running:

```bash
pnpm test -- --testPathPattern='integration|simulate'
```

When finished, stop Redis:

```bash
docker compose -f docker-compose.test.yml down
```

**Environment variables required:**

- `STELLAR_HORIZON_URL` — URL to Stellar Horizon server (e.g., `https://horizon.stellar.org`)
- `STELLAR_RPC_URL` — URL to Stellar RPC endpoint (e.g., `https://soroban-testnet.stellar.org`)
- `NETWORK_PASSPHRASE` — The network where contracts are deployed (e.g., `Test SDF Network ; September 2015`)

These are used by tests in `src/__tests__/integration.test.ts` and `src/__tests__/simulate.integration.test.ts` to verify real API interactions.

### Unit Testing and Mocking

Unit tests should **mock the Stellar RPC** rather than making real network requests. This ensures:

- **Fast test execution** — No network latency
- **Deterministic tests** — Consistent results regardless of network state
- **No external dependencies** — Tests pass in any environment
- **Cost efficiency** — Unlimited mock calls without hitting rate limits

**Example:**
```typescript
jest.mock('../services/rpcClient');

const mockRpcClient = rpcClient as jest.Mocked<typeof rpcClient>;

mockRpcClient.simulateTransaction.mockResolvedValue({
  // mock response
});
```

Check `src/__tests__/fixtures/` for pre-built mock data and `src/services/tests/` for examples of properly mocked service tests.

---

## Code Style

This project enforces consistent style via ESLint, Prettier, and TypeScript strict mode.

### ESLint

- Config: `eslint.config.mjs`
- Only `console.warn` and `console.error` are allowed — no `console.log`
- Run: `pnpm run lint`

### Prettier

- Config: `prettier.config.cjs`
- Run: `pnpm run format`

### TypeScript

- Strict mode is enabled — all new code must be fully typed
- Config: `tsconfig.json`

### Pre-commit Hooks

Husky runs lint and branch name validation automatically before each commit. Commits are rejected if checks fail.

**Automated checks:**
- **TypeScript files** (`.ts`, `.tsx`): ESLint + Prettier
- **Other files** (`.js`, `.jsx`, `.json`, `.md`): Prettier
- **package.json**: `npm audit --audit-level=high` to catch high-severity vulnerabilities

Branch names must follow one of these patterns:

- Protected: `main`, `develop`, `live`
- Prefixed: `feature/`, `fix/`, `refactor/`, `hotfix/`, `release/`, `chore/`, `docs/`

---

## Commit Message Format

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

[optional body]

[optional footer — e.g. Closes #123]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructure, no behavior change |
| `test` | Adding or updating tests |
| `chore` | Maintenance, dependency updates |

### Examples

```
feat(api): add batch simulation endpoint
fix(metrics): correct cache hit counter
docs(contributing): add fork and clone instructions
refactor(optimizer): simplify footprint deduplication
test(simulator): add edge case for expired ledger entries
chore(deps): update @stellar/stellar-sdk to 12.1.0
```

### Rules

- Use present tense: "add" not "added"
- Keep the subject line under 72 characters
- Reference issues in the footer: `Closes #42`

---

## Pull Request Process

1. **Sync with upstream** before opening a PR:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run all checks locally:**
   ```bash
   pnpm run lint
   pnpm run typecheck
   pnpm run format:check
   pnpm run build
   pnpm test
   ```

3. **Open a pull request** against the `main` branch with:
   - A clear title using the commit format (e.g. `feat(api): add restore endpoint`)
   - A description explaining what changed and why
   - A reference to the related issue (e.g. `Closes #12`)

4. **PR Checklist**

   - [ ] Code follows the style guidelines
   - [ ] All existing tests pass
   - [ ] New tests are included for new functionality
   - [ ] No linting or formatting errors
   - [ ] Documentation is updated if needed
   - [ ] Breaking changes are clearly noted in the PR description

5. **Address review feedback** — push additional commits to the same branch; do not open a new PR.

6. **Squash commits** if requested by a maintainer before merging.

---

## Issue Labels

| Label | Description |
|---|---|
| `bug` | Something is broken or behaving incorrectly |
| `enhancement` | A new feature or improvement to existing behavior |
| `documentation` | Improvements or additions to docs |
| `good first issue` | Suitable for first-time contributors |
| `help wanted` | Extra attention or expertise needed |
| `question` | Further information is requested |
| `duplicate` | This issue or PR already exists |
| `wontfix` | This will not be worked on |
| `performance` | Related to speed, memory, or resource usage |
| `security` | Security-related concern or fix |
| `dependencies` | Dependency update or version bump |
| `testing` | Related to test coverage or test infrastructure |

---

Thank you for contributing to Stellar Footprint Service — every improvement helps the Stellar/Soroban community. 🚀
