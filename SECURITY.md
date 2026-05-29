# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Reborn Apps, please report it responsibly using **GitHub's private security advisory** feature:

1. Go to the [Security Advisories](https://github.com/fundacja-reborn/reapps/security/advisories) page
2. Click **"Report a vulnerability"**
3. Provide a clear description, steps to reproduce, and potential impact

Please **do not** open a public issue for security vulnerabilities.

### Encrypted email (alternative)

If you prefer encrypted email over GitHub, you can reach us at **security@reapps.eu**
and encrypt your report with our PGP key:

- **Fingerprint:** `43C7 FFE6 8AA0 C5E9 0E5A 4568 58DB 096C 16C1 2029`
- **Public key:** [`docs/security/pgp-key.asc`](docs/security/pgp-key.asc)
  (also at `https://reapps.eu/.well-known/pgp-key.asc`)

GitHub's private security advisory remains the preferred channel; encrypted email
is offered for researchers who rely on PGP.

## What to Expect

Reborn Apps is maintained on a best-effort basis alongside other commitments, so we're not able to guarantee fixed response times. That said, we take every security report seriously and will review and respond as quickly as we reasonably can - often promptly, occasionally with some delay depending on availability and the complexity of the report.

Every report will be read, acknowledged, and acted upon according to severity. If a report turns out to be out of scope or a duplicate, we will still let you know.

## Scope

The following are in scope:

- Reborn Apps server-side code (API endpoints, authentication, session management)
- Client-side encryption implementation (`@reborn/crypto`, `@reborn/storage`)
- Key management and derivation logic
- Authentication and authorization flows
- Content Security Policy and transport security

The following are **out of scope**:

- **Known CVEs in third-party dependencies** that are already tracked
  by automated tooling (Dependabot, Renovate). However, non-public or
  unreported supply-chain issues affecting Reborn Apps **are** in scope
  - please report them to us.
- Denial of service via rate limiting exhaustion on non-auth endpoints
- Issues requiring physical access to an unlocked device
- Social engineering attacks

## Security Architecture

For details on the cryptographic design and security mechanisms, see the [Security Overview](docs/security/security-overview.md).

## Supported Versions

Only the latest release is supported with security updates.