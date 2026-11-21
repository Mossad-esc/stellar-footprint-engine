# Security Policy

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately using one of these channels:

- **Email:** [jeremiahniffypeter@gmail.com](mailto:jeremiahniffypeter@gmail.com)
- **GitHub Security Advisories:** [Report a vulnerability](https://github.com/Mossad-esc/stellar-footprint-engine/security/advisories/new)

Include as much detail as possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Affected versions or components
- Any suggested mitigations (optional)

## Disclosure Timeline

| Stage | Target timeframe |
|---|---|
| Acknowledgement | Within **48 hours** of report |
| Initial assessment | Within **7 days** |
| Fix developed & reviewed | Within **30 days** (critical issues prioritised) |
| Public disclosure | After fix is released, coordinated with reporter |

We follow a **coordinated disclosure** model. We ask that you give us a reasonable window to address the issue before any public disclosure.

## Scope

### In scope

- The Stellar Footprint Service API (`src/`)
- Authentication and authorisation logic
- Input validation and XDR parsing
- Rate limiting and brute-force protection
- Dependency vulnerabilities with a direct exploit path

### Out of scope

- Vulnerabilities in third-party services (Stellar RPC endpoints, cloud providers)
- Denial-of-service attacks that require significant resources to execute
- Social engineering or phishing attacks
- Issues already reported or known
- Findings from automated scanners without a demonstrated exploit

## Supported Versions

Only the latest release on the `main` branch receives security fixes.

## Responsible Disclosure

We are committed to working with security researchers in good faith. We will not pursue legal action against researchers who:

- Report vulnerabilities privately following this policy
- Do not access, modify, or delete data beyond what is needed to demonstrate the issue
- Do not disrupt the service or other users

## Container Vulnerability Scanning & Remediation

Release Docker images are automatically scanned with [Aqua Security Trivy](https://github.com/aquasecurity/trivy) in `.github/workflows/release.yml` before being pushed to GitHub Container Registry (GHCR). Builds fail on `CRITICAL` or `HIGH` severity vulnerabilities, and SARIF reports are uploaded to the GitHub Security tab.

### Fixing Discovered Container CVEs

1. **Inspect the finding**: Review the Trivy output in the failed release workflow logs or the **Security > Code scanning alerts** tab in GitHub to identify the affected package, CVE ID, installed version, and fixed version.
2. **OS-level vulnerabilities (Alpine base image)**:
   - Update the base image tag in `Dockerfile` (e.g., bump `node:22-alpine` to the latest patch tag or rebuild to pull updated Alpine packages).
   - If a specific Alpine package has a newer patched version available in `apk`, run `apk upgrade --no-cache` in the `Dockerfile` runtime stage.
3. **Node.js dependency vulnerabilities**:
   - Update the vulnerable direct dependency in `package.json` and regenerate `pnpm-lock.yaml` with `pnpm update <package>`.
   - For transitive dependencies that cannot be updated directly, add or bump a version constraint under `pnpm.overrides` in `package.json` and run `pnpm install`.
4. **Verify locally before pushing**:
   ```bash
   docker build -t stellar-footprint-engine:scan .
   trivy image --severity CRITICAL,HIGH --exit-code 1 stellar-footprint-engine:scan
   ```
5. **Unfixed upstream CVEs / false positives**: If a CVE has no upstream fix and is confirmed non-exploitable in this service's context, document the risk assessment and add the CVE ID with an expiration comment to `.trivyignore` only after maintainer review.
