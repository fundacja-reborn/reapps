# Security Overview — Reborn Apps

Reborn Apps is a suite of PWA productivity applications (task management and notes) built on a **True Zero Knowledge end-to-end encryption** architecture. This document describes the security model, cryptographic design, and protective measures currently in place.

---

## 1. Zero Knowledge Architecture

Reborn Apps follows a strict Zero Knowledge (ZK) principle: **the server never has access to user data in plaintext**. All encryption and decryption happens exclusively on the client device.

### What the server knows

| Data | Visibility | Rationale |
|---|---|---|
| `username` | Plaintext | Required for authentication and uniqueness |
| `password_hash` | Argon2id hash | Server verifies credentials; never sees the raw password |
| `master_key_encrypted` | Opaque ciphertext | Encrypted master key stored for cross-device access |
| `master_key_salt` | Plaintext | Required for key derivation on the client |
| Record IDs and foreign keys | Plaintext UUIDs | Required for relational integrity, sync, and authorization |
| `created_at` / `updated_at` | Plaintext timestamps | Required for delta sync and conflict resolution |

### What the server never sees

- **All user content**: task titles, descriptions, note bodies, list/folder/tag names — stored as `*_encrypted` fields (AES-GCM ciphertext)
- **Behavioral metadata**: completion status, starred/pinned flags, due dates, reminders, tag associations — bundled into a single `metadata_encrypted` field per record
- **Device information**: session device details are encrypted client-side (`device_info_encrypted`)
- **No email, phone, or any personally identifiable information** beyond the username

### Deliberate privacy trade-offs

The server sees the **structural graph** (which tasks belong to which list, which notes belong to which folder) because it needs this for cascade operations, per-parent sync, and authorization. However:

- **Tag associations are fully hidden.** Unlike folder membership (1-to-N), tag relationships (N-to-M) would expose a correlation graph that could fingerprint user behavior. Tag IDs are therefore encrypted inside `metadata_encrypted` — no `NoteTag` join table exists on the server.
- **Filtering by tags is client-side only**, performed against an in-memory decrypted index after unlock.

---

## 2. Cryptographic Primitives

| Purpose | Algorithm | Details |
|---|---|---|
| Password hashing | **Argon2id** (hash-wasm) | m=19456, t=3, p=1 |
| Key derivation | **PBKDF2** (Web Crypto API) | 600,000 iterations, SHA-256 |
| Data encryption | **AES-GCM** | 256-bit keys, unique IV per encryption operation |
| Master key wrapping | **AES-GCM** via PBKDF2-derived key | Master key generated locally, never transmitted in plaintext |
| Recovery codes | **SHA-256** | 8 single-use codes (`XXXXX-XXXXX` format), hashed before storage |
| Token signing | **HMAC-SHA256** (JWT) | With support for secret rotation via dual-key verification |

### Key lifecycle

1. **Registration**: A random master key is generated on the client, wrapped with a key derived from the user's password (PBKDF2 600K), and the ciphertext is sent to the server alongside the Argon2id password hash.
2. **Login**: The server returns the encrypted master key. The client derives the wrapping key from the password and decrypts the master key locally.
3. **Session**: The decrypted master key is persisted in IndexedDB (survives browser/PWA restarts) and restored automatically on app load. The key is cleared only on explicit logout. This matches industry practice (Standard Notes, Bitwarden, Proton Mail) — in a Zero Knowledge architecture, client-side storage protection against local device access is out of scope; ZK protects against server-side attacks.
4. **Data operations**: All encrypt/decrypt operations use the master key via AES-GCM. The key never leaves the device.

---

## 3. Authentication & Session Security

### Authentication flow

- Username + password authentication with Argon2id server-side verification
- Optional **two-factor authentication** (TOTP-based)
- **Account recovery** via single-use recovery codes (no email/phone recovery by design)

### Token management

- **Short-lived access tokens** (JWT) with JTI-based blacklisting on logout
- **Refresh tokens delivered exclusively via `httpOnly` cookies** — never exposed in response bodies or accessible from JavaScript, eliminating XSS-based token theft
- **Refresh token rotation** with **family tracking** — if a refresh token is reused (indicating theft), the entire token family is revoked
- **Dual JWT secret support** for zero-downtime secret rotation (`JWT_SECRET` + `JWT_SECRET_PREVIOUS`)

### Brute-force protection

- **Per-username login lockout**: 5 failed attempts trigger a 15-minute lockout window, applied to both login and 2FA endpoints
- **Per-user lockout** on sensitive operations: change-password, 2FA disable, and account deletion all enforce attempt limits with automatic lockout
- **4-layer anti-bot protection** on registration:
  1. **Honeypot** — hidden field rejected if filled
  2. **Timing check** — submissions faster than a human minimum are rejected
  3. **Proof-of-Work (PoW)** — client must solve a server-issued HMAC-SHA256 challenge before the server accepts the request (no third-party CAPTCHA, consistent with Zero Knowledge — no external tracking)
  4. **Server-side signature verification** — the PoW challenge is signed server-side and verified before solution is checked
- **Constant-time responses** on login and registration to prevent username enumeration via timing side-channels
- **IP resolution hardening**: right-to-left `X-Forwarded-For` parsing with configurable trusted proxies (RFC 1918 awareness) to prevent IP spoofing

---

## 4. Transport & Content Security

### HTTP security headers

- **HSTS**: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production only)
- **Content Security Policy**: Nonce-based CSP (`mode: 'nonce'`) — eliminates `unsafe-inline` from `script-src`. Script sources restricted to `'self'`, `'nonce-…'`, and `'wasm-unsafe-eval'` (required for Argon2id WASM). Additional directives: `base-uri: 'self'`, `form-action: 'self'`, `object-src: 'none'`
- **X-Frame-Options**: `DENY` — prevents clickjacking (consistent between nginx and application layer)
- **X-Content-Type-Options**: `nosniff` — prevents MIME-type sniffing
- **Server identity hiding**: `server_tokens off` in nginx — prevents version disclosure
- **Request size limit**: 1 MB maximum request body (enforced at both nginx and application level)

### Authorization & input validation

- **Ownership verification on every data endpoint** — all CRUD operations filter by `user_id` from the authenticated JWT; no endpoint relies on client-supplied user IDs (IDOR-safe by design, verified across all 47 API endpoints)
- **Auth middleware** in both applications' server hooks validates JWT on every protected request
- Centralized request validation using **Zod** schemas (`validateBody()`) applied to all data endpoints (tasks, notes, folders, tags, subtasks, push subscriptions)
- HTML output from Markdown rendering sanitized via **DOMPurify** with restricted URI schemes

### Sync integrity

- **Idempotency middleware** on write endpoints prevents duplicate operations during offline sync retry

---

## 5. Client-Side Security

### Offline-first storage model

- **IndexedDB is the source of truth** — the app works fully offline, syncing in the background when connectivity is available
- **Separate IndexedDB databases per application** (`Reborn_task_DB`, `Reborn_notes_DB`) — prevents cross-app data corruption during schema upgrades
- **No optimistic UI updates** — the interface reflects data only after confirmed writes
- **Shadow indexes** (decrypted copies of sort/filter fields like `is_completed`, `due_date`) exist only in local IndexedDB for query performance — they are **stripped before any server sync**

### Encryption Guard

All data leaving the client passes through a **3-layer encryption validation** pipeline:

1. **Post-encrypt**: validates ciphertext format (`iv:ciphertext`) immediately after encryption
2. **Pre-save**: validates before writing to IndexedDB
3. **Pre-sync**: validates before sending to the server

This defense-in-depth approach ensures that plaintext data cannot accidentally be persisted or transmitted due to an encryption failure.

### Import content sanitization

Markdown content imported from external sources (`.md` files, Obsidian vault folders) is sanitized **before** encryption and storage:

- **Base64 images** (`![alt](data:...)`) — stripped (alt text preserved, data URI removed)
- **Dangerous HTML tags** (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<style>`, `<link>`) — removed entirely
- **Unsafe URI schemes** in links (`javascript:`, `vbscript:`, `data:text/html:`) — stripped (link text preserved)
- **Tags from frontmatter** — validated against safe character whitelist, length-limited

Additionally, base64 data URIs are blocked at all editor entry points (image dialog, paste, drop) and render as a warning placeholder in the preview. This is a defense-in-depth measure — DOMPurify protects at the rendering stage, but sanitizing at input prevents dangerous content from being persisted.

### Cross-app SSO

- Single sign-on between applications uses **shared `localStorage`** on the same origin (behind a reverse proxy), not IndexedDB — preserving database isolation

---

## 6. Supply Chain & Repository Security

### Build & dependencies

- **Automated dependency auditing** via `pnpm audit` in the CI pipeline
- **Automated dependency updates** via Renovate (covers both version updates and security patches; Dependabot version-updates is intentionally disabled to avoid duplicate PRs from two bots)
- **Monorepo module boundaries** enforced by Nx and ESLint (`@nx/enforce-module-boundaries`)
- **TypeScript strict mode** across the entire codebase
- **Docker production hardening**: non-root containers (`su-exec node`), no exposed database ports (DB accessible only via internal Docker network)

### GitHub repository controls

*Last verified: 2026-05-12*

Every push and pull request is automatically inspected by GitHub-native tooling. These controls run at repository level, independent of contributor permissions or branch protections:

- **CodeQL analysis** (default setup) - static analysis on every push and PR plus a scheduled rescan. Findings of severity **High or higher fail the merge check** (configurable failure threshold). **Copilot Autofix** is enabled and proposes remediations on detected issues.
- **Dependabot alerts** - vulnerability notifications across all manifest-tracked dependencies, with a custom rule preset configured to triage alert noise
- **Dependabot malware alerts** - separate channel for known-malicious packages, independent of CVE-driven alerts
- **Secret scanning with push protection** - commits containing recognized secret patterns are **rejected at push time**, not merely flagged after the fact
- **Code quality findings** - GitHub's standard quality analysis runs alongside CodeQL
- **Private vulnerability reporting** - external researchers can disclose findings through a private channel; see [SECURITY.md](../../SECURITY.md)
- **Security advisories** - published vulnerability advisories for downstream consumers when applicable
- **Prevent direct alert dismissals** (code scanning) - actors must submit a dismissal request rather than silently closing a finding, preserving an audit trail

---

## 7. Known Limitations & Transparency

In the spirit of transparency, these are conscious trade-offs in the current architecture:

| Area | Status | Notes |
|---|---|---|
| `style-src: 'unsafe-inline'` | Accepted | Required by SvelteKit's inline style generation. CSS-based exfiltration is significantly harder to exploit than script injection. |
| `img-src: 'https:'` in Notes | Accepted | Required for external images embedded in Markdown notes. Task app restricts to `'self' data:` only. |
| JWT algorithm | HMAC-SHA256 | Asymmetric signing (ES256) is planned but not yet implemented. Acceptable for a single-server deployment. |
| Token blacklist | In-memory | Access token blacklist is not persisted across server restarts. Risk is low given the short token lifetime (15 minutes). Redis-backed persistence is planned for multi-instance deployments. |
| No email-based recovery | By design | This is a feature, not a limitation — it ensures the server holds no PII beyond the username. Users are responsible for securely storing their recovery codes. |

---

## 8. Reporting Security Issues

If you discover a security vulnerability, please report it responsibly. See the repository's [SECURITY.md](../../SECURITY.md) for details, or open a private security advisory via GitHub.

---

*Last updated: 2026-05-12*
