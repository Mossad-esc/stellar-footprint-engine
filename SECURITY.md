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
