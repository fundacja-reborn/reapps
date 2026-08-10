# Threat Model v0.1 - Reborn Apps E2E Sharing

> **Status**: v0.1 published in the repository as a design artifact before extending the sharing primitive into a collaborative model. The document is a **baseline version**; it serves as a living document, updated ad hoc on design decisions during implementation and after external audit findings.
>
> **Purpose of the v0.1 publication**: to show that (1) we know where the real attack vectors are before we start implementation, (2) the sharing protocol is not a "feature add-on" but a deliberate extension of the existing threat model, (3) the scope boundary (in/out) is drawn intentionally, not from a lack of awareness. The document is an invitation to peer review - feedback from the community (cryptographers, security researchers, peer FOSS projects) is welcome.
>
> **Code version**: the Reborn Apps applications at commit `main@a83e931` (release v0.26.5, 2026-05-29). Public design documentation of the shipped sharing primitive: [`docs/security/read-only-snapshot-sharing.md`](https://github.com/fundacja-reborn/reapps/blob/main/docs/security/read-only-snapshot-sharing.md).

---
## 0. Executive summary

Reborn Apps are two PWAs (Reborn Task, Reborn Notes) with a **zero-knowledge end-to-end encryption** architecture. All user content (titles, descriptions, behavioral metadata, tag-note relations) is encrypted locally in the browser; the server sees only ciphertext and the `username`. The current state includes:

- **Core ZK model**: AES-GCM 256 encryption, master key wrapped with PBKDF2 600k iterations, password hash with Argon2id (OWASP 2025 params, m=19MiB t=3). Reviewed internally during development (internal reports are not published).
- **Read-only snapshot primitive** (shipped 2026-05-14, release v0.23.0+): a public Bitwarden Send-style capability URL with an AES-GCM 256 key in the URL fragment, an anonymous viewer, one-time ciphertext + an optional password (Argon2id) + expiry + max-access count. Granularity: per-note in Notes, per-task in Task. The primitive passed a feature-focused internal security review as a pre-merge quality gate.

**Scope of the next development phase**: extending the sharing primitive into **collaborative bidirectional sharing** between authenticated users, with a persistent ACL, per-recipient key wrapping (per-user identity), revocation with re-encryption (key rotation for future content), an invitation flow with an out-of-band token. A second result: a public protocol specification as an RFC-light reference for the ecosystem of zero-knowledge tools.

This document models threats for the **entire sharing pipeline**: both the shipped snapshot primitive (as a baseline) and the collaborative protocol (as the scope of the next phase).

---

## 1. Document scope

### 1.1 In scope

| Area | Status |
|---|---|
| Core Zero Knowledge model (key derivation, master key wrap, Encryption Guard) | Shipped, baseline of assumptions |
| Authentication & session management (JWT with dual-secret rotation, refresh-token family tracking, PoW anti-bot on registration) | Shipped, baseline of assumptions |
| Read-only snapshot sharing (anonymous viewer, capability URL) | Shipped, audited internally |
| Collaborative E2E sharing protocol (persistent ACL, key exchange, per-recipient wrap, revocation, invitation) | **Design phase**, this document models the threats before implementation |
| Sharing-specific UX surface (anti-phishing gates, conflict resolution, revocation UX) | Partly shipped (snapshot), partly design phase |

### 1.2 Out of scope (deliberately, with justification)

Each of the items below is a **real risk** but out of scope for this document (or out of scope for the project as a whole). Each has a dedicated section in "9. Out of scope" below with the appropriate justification.

- Side-channel attacks (timing analysis at the JavaScript engine level, cache side channels, Spectre-class)
- Compromise of the client device (malware, keylogger, evil-maid before pre-encryption)
- Full hiding of the sharing graph (PIR-class anonymity, mix networks)
- Quantum-resistant cryptography (post-quantum migration is a separate future scope)
- Real-time collaborative editing (CRDT-based concurrent edits)
- Social engineering (phishing recipients out-of-band, mimicking the interface at the OS level)
- Hardware supply chain attacks
- Legal compulsion in jurisdictions outside the EU (the model for EU jurisdiction is modeled; a legal request in PL is discussed in section 9)

---

## 2. Assets

A list of everything that can be a target of attack - ordered from the most to the least sensitive.

### 2.1 Tier 1: Critical (loss = full deanonymization of the user's content)

| Asset | Location | Consequence of compromise |
|---|---|---|
| The user's `master_key` (256-bit AES-GCM) | Only in browser memory + the `reborn_crypto_keys` IndexedDB (encrypted with a session key in the browser) | Full access to all of the user's plaintext data (all notes/tasks/metadata) |
| The user's password (plaintext, transiently in memory during login/registration) | Only in memory for the duration of the operation | Derivation of the master key (PBKDF2 wrap), full account access |
| `share_cek` per-share content encryption key (256-bit AES-GCM) | Snapshot: in the URL fragment (`#k=...`). Collaborative: wrapped per-recipient in `payload_encrypted` | Plaintext of one specific shared resource |

### 2.2 Tier 2: Very sensitive (loss = exposure of the user's content)

| Asset | Location | Consequence of compromise |
|---|---|---|
| Plaintext titles / contents of notes/tasks | Only on the client side after decryption | Exposure of specific content |
| Sensitive metadata (is_completed, due_date, is_starred, tag_ids, position_in_list) | `metadata_encrypted` per resource | Exposure of usage behaviors and patterns |
| Folder/list/tag names | `name_encrypted` per entity | Exposure of the user's mental taxonomy |

### 2.3 Tier 3: Sensitive (loss = exposure of sharing intent or a correlation surface)

| Asset | Location | Consequence of compromise |
|---|---|---|
| Wrapped per-recipient CEK (a copy of the CEK wrapped with the recipient's identity key) | Server-side in the `*_encrypted` bundle | Without the recipient's master key - useless (defense-in-depth against correlation) |
| Identity public key per user | Server-side, plaintext (for lookup at invitation) | Potential MITM on key substitution (mitigation: out-of-band fingerprint) |
| Sharing graph (who shares what with whom - the fact of the A->B relationship on resource ID X) | Server-side, plaintext (FK to `User.id`) | The ability to build a social graph (who is linked to whom by a sharing operation); content still hidden |
| Invitation token (one-time, used to bootstrap trust between A and B) | Generated locally, passed out-of-band, one-time | Capture before first use = the possibility of a MITM on the first key exchange |
| Device list per user (the list of active devices from session/refresh-token management) | Server-side, plaintext (count + opaque device IDs) | "User B has 3 devices" - low-sensitivity, but fingerprinting-friendly |
| 2FA recovery codes (plaintext at the moment of generation on the user's side) | The server holds only the SHA-256 hash; only the user knows the plaintext (to keep offline as a TOTP backup) | **2FA bypass material** - allows bypassing the TOTP code in the login flow. By itself it **does not reveal content**: without knowing the password, an attacker cannot recover the master key and cannot decrypt the data. Real impact requires a **combination** (recovery code + a compromised password) - it lowers the defense-in-depth of two-factor authentication, it does not replace it |

### 2.4 Tier 4: Low sensitivity (already accepted as server-visible in the core ZK model)

| Asset | Server visibility | Comment |
|---|---|---|
| `username` | Plaintext (unique identifier) | Deliberately chosen - no email/phone (no PII) |
| `created_at` / `updated_at` | Plaintext (required for delta sync) | A pattern of activity over time |
| `id` (UUID) of all objects | Plaintext (primary key) | Required for sync addressing |
| `folder_id` / `task_list_id` (structural FK) | Plaintext (tree structure) | The server sees "the user has N folders, folder X has M notes", but does not know the names |
| Ciphertext sizes (after the padding strategy) | Plaintext (network layer) | Approximate content size - accepted |

---

## 3. Trust boundaries

### 3.1 Trust map (collaborative scenario, after implementation)

```
[Owner A device]  <-trusted->  [Owner A another device]
        |
        | HTTPS (TLS 1.3)
        v
   [Server]  <-untrusted->  Other clients (semi-trusted recipients)
        |
        | HTTPS (TLS 1.3)
        v
[Recipient B device]  <-trusted->  [Recipient B another device]

Out-of-band channel (Signal/email/in-person):
[Owner A] ====invitation token====> [Recipient B]
```

### 3.2 Boundary classification

| Boundary | Status | Assumptions |
|---|---|---|
| **Owner's browser memory** (after decryption) | Trusted | The user entered the password on their own device; the key in memory is legitimately there |
| **Owner's `reborn_crypto_keys` IndexedDB** (session-encrypted master key) | Trusted | Local disk, browser sandbox isolation. Compromise = full account compromise (out of scope: malware on the device) |
| **Network between owner and server** | Untrusted | TLS 1.3 mandatory, HSTS, but the model assumes TLS can fall (active MITM, compromised CA) |
| **Server (`apps/reborn-{task,notes}/src/routes/api/`, PostgreSQL DB)** | **Untrusted (honest-but-curious + adversarial)** | It can be taken over, the operator can be compelled by a legal request, the code can be modified. The entire security model assumes the server has no plaintext and cannot obtain it |
| **Network between server and recipient B** | Untrusted | As above |
| **Recipient B's browser** | Semi-trusted | B has legitimate access to the content after decryption; it is a cooperative user, but may be compromised or adversarial after a leak. The model distinguishes "B has access" (correct) from "B was revoked but extracted plaintext earlier" (acceptable residual risk - a post-revocation access gap) |
| **Out-of-band channel (Signal/email/in-person)** | Untrusted, but assumed-private-enough | The choice of channel is on the user's side; the protocol only requires that the invitation token be delivered to B without interception |
| **Browser engine** (V8, SpiderMonkey, JavaScriptCore) | Trusted (out of our scope) | We accept it as a trusted dependency; supply-chain attacks on the browser are a separate scope (out of scope) |

---

## 4. Threat actors

Who might want to attack the system, with what capability and what motive.

| ID | Actor | Capability | Motive |
|---|---|---|---|
| **TA1** | Honest-but-curious server operator | Full access to the DB, logs, network traffic; does not modify the code | Metadata leaks (who with whom, when, what sizes), commercial intelligence, curiosity |
| **TA2** | Compromised/malicious server | Full modification of the server code, the ability to inject its own responses to clients, modify the DB on the fly | Active MITM on key exchange, downgrade attacks, exfiltration, sabotage |
| **TA3** | Network attacker (passive) | Passive eavesdropping on wire traffic (after HTTPS - only via BGP hijack, ISP level, etc.) | Traffic analysis, timing correlation |
| **TA4** | Network attacker (active MITM) | TLS termination + re-encryption (with a compromised CA / corporate proxy / state-level actor) | Full payload substitution, attacks on key exchange |
| **TA5** | Compromised recipient device | Full access to B's plaintext after decryption, but limited to content B normally sees | Exfiltration of shared content, replay of edits |
| **TA6** | Recipient post-revocation | B previously had access, was revoked; has a copy of historical ciphertext and a key in memory/dump | An attempt at further access to content (outside the revocation boundary - revocation covers future content only) |
| **TA7** | External actor with a capability URL link | An anonymous party who obtained a public link (forward, leak, scrape) | Access to a read-only snapshot without authorization |
| **TA8** | Insider from the owner's organization | A person from owner A's organization who sees their device (e.g. a colleague, IT admin) | Off-screen content harvest, peer-over-shoulder, evil-maid (out of scope for a remote threat model, but it affects UX hardening) |
| **TA9** | Legal compulsion (PL/EU jurisdiction) | A court order to hand over data directed at Fundacja Reborn as the server operator | Compelling access to users' data (acceptable exposure: ciphertext + structural metadata; **unavailable**: plaintext content) |
| **TA10** | Bot / scraper of public URLs | An automatic crawler on a public capability URL (Slack/Discord unfurl, Google crawler) | Unintended consumption of a max-access slot, exposure of preview metadata |

---

## 5. Security assumptions (trust assumptions)

Explicit assumptions this threat model makes. Violation of any of them = a model update is required.

1. **The browser is a trusted runtime.** The browser engine correctly isolates the origin, IndexedDB does not leak cross-origin, the `Web Crypto API` implements AES-GCM, PBKDF2, ECDH per the standard. Compromise of the browser engine = out of scope.

2. **Argon2id (via `hash-wasm`) is faithfully implemented.** No side-channel leakage from the WASM module. The parameters m=19 MiB, t=3, p=1 are OWASP 2025 compliant.

3. **PBKDF2 with 600,000 iterations + SHA-256** is computationally hard against offline password cracking in 2026. The assumption is reviewed on migration to other KDFs or when GPU/ASIC capability radically increases.

4. **AES-GCM with a 96-bit random IV** - secure up to the birthday bound of 2^32 encryptions per key. The per-user master key: in typical usage we do not approach the bound within a meaningful horizon (see `docs/architecture/zero-knowledge-architecture.md`, the "AES-GCM Birthday Bound" section).

5. **TLS 1.3 + HSTS** for all client-server connections. Assumption: a correctly configured server (nginx prod config) plus CA infrastructure. Certificate issuance for `reapps.eu` is constrained by a DNSSEC-signed CAA record (RFC 8659) to a single CA (Let's Encrypt), with wildcard and S/MIME issuance forbidden - this narrows the mis-issuance surface from every publicly trusted CA to one, but does not close it: a compromise of that CA, a CA that ignores CAA, or an attacker who takes over our DNS account (and rewrites CAA along the way) all remain beyond our control. Active MITM with a compromised CA is therefore still assumed possible - TLS is **defense-in-depth**, not the sole line of defense.

6. **The out-of-band channel for the invitation token** is "private enough". We do not define "enough" precisely - that is a user decision. The minimum assumption: the channel does not log the content of the token on the operator's side (so e.g. SMS in some jurisdictions is **insufficient**). Recommended: Signal, in-person, a physical QR code, end-to-end-encrypted email (PGP).

7. **The user reads and understands the UX warnings** about cooperative trust ("anyone with access to the shared resource can edit and read"), revocation gaps ("revoke does not undo B's historical access"), out-of-band token security ("do not send this link publicly"). The UX must communicate these warnings, but we accept that some users will ignore them - this is **acceptable user error**, not a protocol failure.

8. **Fundacja Reborn (the operator) has honest intentions** at the present moment, but **the code is written as if the foundation were untrusted** (zero knowledge does not depend on trust in the operator). **Even if the foundation is taken over, sold, or legally compelled, users' plaintext content is unavailable**.

---

## 6. Threat matrix: shipped Zero Knowledge core (baseline)

The full threat model of the core ZK model is documented in the internal security reviews (reports remain internal, not published). The table below extracts the **key threats** relevant as a baseline for sharing - that is, those that the sharing protocol must at least preserve, not degrade.

| ID | Threat | Actor(s) | Mitigation | Status | Residual risk |
|---|---|---|---|---|---|
| **CORE-1** | Plaintext content in network traffic | TA1, TA2, TA3, TA4 | All `*_encrypted` fields are encrypted client-side before POST; a 3-layer Encryption Guard (post-encrypt, pre-save, pre-sync) with regex validation in the `${iv_b64}:${ciphertext_b64}` format (both parts base64) | Mitigated | Very low; every new field must pass the Guard |
| **CORE-2** | The master key leaks to the server | TA1, TA2 | The master key is generated locally; the server receives only `master_key_encrypted` (PBKDF2 600k wrap with a key derived from the password) | Mitigated | Low (requires reworking the KDF without revealing the password) |
| **CORE-3** | Offline password brute force after a DB dump | TA2, TA9 | Argon2id m=19MiB t=3 + a 32-byte unique salt per user (parameters OWASP 2025-compliant via `hash-wasm`); legacy bcrypt hashes are explicitly rejected on verification (no auto-migration in the browser); migration of legacy PBKDF2 -> Argon2id is provided as auto-rehash on a successful login | Mitigated | Acceptable for strong passwords; a user-education problem |
| **CORE-4** | Plaintext leakage in server logs | TA1, TA2 | The server-side `createLogger` in `@reborn/utils` redirects to `console` (with `JSON.stringify` on objects); the "no payload / no token / no slug" discipline is a **convention not automatically enforced** (no CI lint in the current pipeline). The username (Tier 4) is deliberately logged in the info-level audit trail | Discipline-dependent (no automated check) | Medium - relies on the discipline of the code author; a runtime check + an ESLint rule are planned as Q9 (section 10.7) |
| **CORE-5** | XSS via markdown in note content | TA5 (compromised collaborator), TA7 (if sharing) | `marked` -> DOMPurify with `USE_PROFILES.{html,svg}` + ALLOWED_URI_REGEXP; ALLOWED_TAGS = the DOMPurify default whitelist (audited as part of upstream); auto-escape via Svelte `{...}` on non-markdown text; the same component used in the public snapshot viewer | Mitigated | Low; every change to the markdown pipeline requires an audit |
| **CORE-6** | IV reuse in AES-GCM (catastrophic) | (programming error) | `crypto.getRandomValues(new Uint8Array(12))` per encrypt; never reused; tested with unit tests | Mitigated | Very low |
| **CORE-7** | Session token replay | TA3, TA4 | JWT with a 15-min access expiry + 30-day sliding refresh (single source of truth: `REFRESH_TOKEN_TTL_*` in `@reborn/auth`, applied consistently to the cookie `maxAge`, `RefreshToken.expires_at` and `UserSession.expires_at`); the refresh token lives only in an httpOnly + secure + sameSite=lax cookie; refresh-token family tracking (reuse = revoke the entire family); dual JWT secret rotation | Mitigated | Low for access replay (window <15 min). A stolen refresh token is replayable until the next rotation (TTL up to 30 days), but it is not readable from JS (httpOnly) and any parallel reuse trips family revocation |
| **CORE-8** | PoW bypass on registration | TA2 (with the motive of flooding the DB) | A multi-layered defense against bots on the registration endpoint: (1) the honeypot field `website`, (2) a check of the minimum form-fill time `_t`, (3) Proof-of-Work with HMAC-SHA256 signed with a server secret (`JWT_SECRET`) - the HMAC binds `salt:challenge:difficulty:expiresAt`, (4) IP-based rate limit `registerLimiter` (3/h) as defense-in-depth. The PoW challenge has a 5-min TTL and is one-shot (server-side `usedSalts`). IP/UA binding to the payload HMAC is considered as additional hardening - see Q11 (section 10.8) | Mitigated | Low - acceptable for our scale; without IP/UA binding a single challenge could theoretically be distributed across a pool of bots within the TTL window |
| **CORE-9** | Sensitive metadata leakage via a plain column | TA1 | All behavioral metadata (`is_completed`, `due_date`, `is_starred`, `is_pinned`, `tag_ids`) in the `metadata_encrypted` JSON bundle; no `NoteTag` join table on the server (removed in the migration `20260418045622_remove_notetag_join_table`); the remaining plaintext flags (`is_default`, `is_template`, `is_archived`) are structural/operational, not behavioral | Mitigated | Low; schema review at every migration |
| **CORE-10** | Server-side enumeration of users via username collision on registration | TA10 | Registration returns a distinct `"Username already taken"` for a collision vs a unified `"Registration failed"` for the bot-protection failures (honeypot / timing / PoW); the collision is checked **after** PoW verification, adding a timing oracle. The per-IP `registerLimiter` (3/h) limits but does not eliminate enumeration. Unifying the string + a dummy hash to equalize timing is considered as hardening (Q12) | Not mitigated (low-rate targeted enumeration) | Medium - body + timing oracle. Accepted because `username` is deliberately Tier 4 server-visible in the core ZK model (section 2.4) |
| **CORE-11** | Username enumeration via per-username login lockout (login endpoint) | TA10 | `loginLockout` returns 429 after 5 failed attempts on a specific username, while a non-existent account returns 401 - distinguishing existing from non-existent accounts without the password. Per-username keying is deliberate (it protects a specific account against brute force; removing it would weaken protection against credential stuffing). Re-keying per `(ip, username_hash)` with a dummy lockout is considered (Q12) | Not mitigated | Low impact (username is Tier 4 server-visible); an additional oracle to CORE-10 |
| **CORE-12** | Malicious code delivery via the application server (the browser-loaded JavaScript ZK problem) | TA2 | A structural limit of the PWA architecture: the application server can substitute the served JavaScript bundle, and a substituted client can export plaintext or keys before it encrypts anything - bypassing all E2E layers (master key, encrypt-before-send, Encryption Guard, AES-GCM) in the first tick. Defense-in-depth considered for v1 (Q13): Subresource Integrity (SRI) + Service Worker app-shell pinning (TOFU for code). Full mitigation requires an external code-distribution channel (browser-extension verifier, reproducible builds + binary transparency log, native apps) - post-v1. Self-hosting (AGPL-3.0 + Docker compose, in the repo) eliminates TA2 for the code-delivery problem at the cost of the user's own operational burden. Justification and the PWA trade-off: section 9.9 | Partial mitigation / architecture-bounded | **Medium - a structural limit of any browser-based cryptography**; a full solution requires an external code-distribution channel. Deliberately accepted as a consequence of the PWA architecture choice |

---

## 7. Threat matrix: read-only snapshot primitive (shipped)

These threats are **already addressed** in the shipped capability URL primitive. Noted here as reference patterns for the collaborative protocol. Full design documentation: [`docs/security/read-only-snapshot-sharing.md`](https://github.com/fundacja-reborn/reapps/blob/main/docs/security/read-only-snapshot-sharing.md).

| ID | Threat | Actor(s) | Mitigation in the shipped primitive | Status |
|---|---|---|---|---|
| **SNAP-1** | The key in the URL fragment reaches the server log / `Referer` header | TA1, TA2 | RFC 3986 §3.5 (the fragment never goes in the request line); `Referrer-Policy: no-referrer` on the public endpoint; `<meta name="referrer" content="no-referrer">`; explicit log-redaction rules | Mitigated |
| **SNAP-2** | The ciphertext is cached in an intermediary proxy/CDN | TA3 | `Cache-Control: no-store, no-cache, must-revalidate, private` on every response from `/api/shares/[slug]` | Mitigated |
| **SNAP-3** | The Service Worker serves a stale app-shell instead of the public viewer (the SPA fallback breaks assets) | (regression) | SW bypass for `${base}/s/*` and `${base}/api/shares/*` in `service-worker.ts`; verified manually + a regression test | Mitigated |
| **SNAP-4** | The anonymous viewer leaves a trace in IndexedDB | TA8 (peer-over-shoulder on someone else's device) | Three-layer bypass: `hooks.client.ts` (top-level), `+layout.svelte` (early return), `cryptoManager` (lazy IDB) - rule #12 in `59-shared-readonly-snapshots.md` | Mitigated |
| **SNAP-5** | The anonymous viewer stores a preferred language and leaves a fingerprint | TA1 (longitudinal) | Locale isolation: `persistPreference: false` on the `/s/<slug>` path; no write to `localStorage` | Mitigated |
| **SNAP-6** | Phishing via a spoofed share UI (an attacker passes a fake link looking like ours) | TA7 (with malicious intent) | Branded blocking states (`ShareGate.svelte`, `LEARN_MORE_URL` hardcoded), a branded password gate (a visual mirror of LoginForm) - 7 states | Mitigated |
| **SNAP-7** | Max-access count TOCTOU race condition | TA7 (parallel consume) | Atomic `UPDATE ... WHERE access_count < max_access_count RETURNING ...` raw SQL with a row lock; the SELECT before the UPDATE is only for the password gate / a discriminated 410 | Mitigated |
| **SNAP-8** | Password oracle (response time discloses a password match) | TA7 (brute force) | A dedicated `sharePasswordLimiter` (10/15min/IP, separated from `authLimiter`); Argon2id verify (slow by design); a 410 response for all exhausted/revoked/expired states | Mitigated |
| **SNAP-9** | Storage abuse via unlimited create | TA1 (free-tier abuse), legit user error | `shareCreateLimiter` (30/h per `userId`, sliding window); active shares count toward the storage quota in Notes | Mitigated |
| **SNAP-10** | The original title (sensitive) leaks to the recipient even if the owner wants to display an innocuous name | TA5 (cooperative recipient seeing more than intended) | A `display_name` override field in the ciphertext payload (max 80 chars, Zod-validated); the recipient sees only `display_name` if set | Mitigated |
| **SNAP-11** | Organizational metadata (is_starred, recurrence rules, tags) in the payload exposed to the recipient | TA5 | Zod schemas WITHOUT `.passthrough()`; pre-encryption strip of unknown fields from the payload; a restricted whitelist per type (note vs task) | Mitigated |
| **SNAP-12** | OG meta tags reveal sensitive content to bots (unfurl preview cache in messengers) | TA10 | Server-side OG injection in `localeHandle` (hooks.server.ts); a generic description hardcoded - "End-to-end encrypted snapshot of a note/task shared with you"; we do NOT inject data from the snapshot | Mitigated |
| **SNAP-13** | `source_id` (the note/task UUID) visible as a plaintext column on the server - a correlation surface | TA1 (mapping share -> source) | `source_id` in the payload (encrypted), never as a plaintext column on `SharedSnapshot` | Mitigated |
| **SNAP-14** | A crawler/bot consumes a max-access slot before the legitimate recipient | TA10 | Heuristic: `display_name` in OG is generic + the URL fragment is inaccessible to crawlers (the key does not go to the bot); a Slack/Signal unfurl bot **does not decrypt**, so it does not consume a slot (it requests `/api/shares/[slug]` but without the key there is no decryption; optionally max-access blocks at the UPDATE level) | Partially mitigated |

---

## 8. Threat matrix: collaborative E2E sharing (design phase)

These threats are **new or strengthened** in the collaborative protocol (out of scope for the shipped snapshot). This is the core analysis of this version of the threat model (v0.1) - it will be updated during implementation and after external audit findings.

### 8.1 Key exchange & identity (TA2 dominant - malicious server)

| ID | Threat | Actor(s) | Proposed mitigation (to be validated in the external audit) | Trade-off |
|---|---|---|---|---|
| **COL-1** | The server substitutes its own `identity_public_key` as B's key at invitation lookup (MITM on the first key exchange) | TA2 | **v1 model: TOFU (Trust on First Use) with UX warnings.** The first key fingerprint seen for a counterparty is stored locally at A and at B; any later change = an explicit UX warning. The out-of-band invitation token (COL-16) is the delivery channel for bootstrapping the share, but in v1 it is **not** treated as cryptographic authentication of the identity key. Manual key-fingerprint verification (a Signal-style safety number) is **out of scope for v1** and planned post-v1 as the strong defense against an active first-contact attacker | TOFU is UX-friendly but weak against an active attacker on the very first contact - **accepted residual risk for v1**, surfaced in the UX. Safety-number verification (post-v1) closes the first-contact gap at the cost of friction |
| **COL-2** | The server substitutes a different key for different devices of the same user (B sees different content on the laptop vs the phone) | TA2 | A pure per-user identity key (unwrapped with the master key at each device unlock); all of a recipient's devices use the same identity key, so the server has no per-device vector for substituting different keys. The identity public key is protected against substitution by the COL-1 mechanism (TOFU with UX warnings in v1; safety-number verification post-v1) | Per-user identity eliminates per-device divergence by design; we accept that a compromised device = compromised access for that user (symmetric with the core ZK model) |
| **COL-3** | Replay of encrypted operations (the server replays an old "edit" to B who has already been deprived of access) | TA2 | Target mitigation: each operation is signed (HMAC) with a signing key derived from the share + a monotonic counter per resource; clients track the last-seen counter and reject old operations | **Requires a digital signing layer - out of scope for v1** (Q3, section 10.2). In v1 the risk is accepted in the cooperative-trust model; the signing layer is planned as v2 after the audit |
| **COL-4** | The server injects a false "revocation" message causing a legitimate recipient to lose access | TA2 | Target mitigation: access-revocation operations are signed with the owner's key; the signed message contains the resource ID + the recipient ID + a timestamp; clients verify the signature before applying | **Requires a signing layer - out of scope for v1** (Q3). In v1 the risk is accepted; the mitigation is planned as v2 after the audit |

### 8.2 Multi-device & key wrapping

| ID | Threat | Actor(s) | Proposed mitigation | Trade-off |
|---|---|---|---|---|
| **COL-5** | A compromised device of B (e.g. stolen) has access to all of B's shared resources | TA5 | Per-user CEK wrapping (Q2) - revoke works at the level of recipient B (all of B's devices lose access simultaneously); eager re-encryption (Q4) of all of B's shared resources on revoke. A compromised device of B exposes B's access to shared resources exactly as it exposes access to B's own data - a residual risk accepted as symmetric with the core ZK model | Per-user wrap keeps storage manageable (one wrapped CEK per recipient). We do not introduce per-device revocation granularity - it would be asymmetric complexity relative to the own-data model, which makes no such distinction |
| **COL-6** | User B adds a new device - how should it be authorized to existing shared resources without a re-share by A? | TA1 (correlation), (UX) | B on the new device enters the password -> recovers the master key (PBKDF2 wrap); the master key unwraps `identity_key_wrapped` fetched from the server (Q1) -> the per-user identity key; the identity key unwraps all wrapped CEKs per share; the new device auto-receives access at the next sync. Edge case: B loses the password - out of scope for the sharing protocol (a standard consequence of the zero-knowledge model: without the password there is no master key, so no access to any resource - own or shared) | The per-user identity key is stable across password changes - the master key stays the same on a password change (only the external PBKDF2 wrap of the master key rotates), so identity_key_wrapped (wrapped with the master key) does not need re-wrapping either |
| **COL-7** | The server enumerates the device list per user (the list of devices = a fingerprint surface) | TA1 | Accepted as **server-visible**: the server knows how many devices user B has from session/refresh-token management (not from wrap distribution - pure per-user wrapping needs no device list). No in-scope mitigation | The trade-off is acceptable - the device count is a weaker signal than content |

### 8.3 Revocation & key rotation

| ID | Threat | Actor(s) | Proposed mitigation | Trade-off |
|---|---|---|---|---|
| **COL-8** | B is revoked but keeps historic ciphertext + a key in memory/dump - reads old content | TA6 | **Accepted residual risk** - revocation protects against **future** edits, not historic data. An explicit UX warning on revoke: "Revoke prevents future access to changes. Existing copies of past content may remain accessible to the revoked recipient." | Retroactive revocation of content B already holds would require re-encryption everywhere AND forcing a delete on B's device - impossible in a distributed system without DRM. This is key rotation for future content, not forward secrecy (which would protect past content) |
| **COL-9** | Race condition: B reads the resource while A is revoking (B receives plaintext even though A has already revoked) | TA5 with a timing motive | Eager re-encryption: A sends a signed revocation message + a new wrapped CEK for the remaining recipients atomically (a single server transaction). The server does not return old ciphertext after acceptance of the revocation. The race window is limited to the propagation delay (~100ms on a typical network) | Acceptable - the race window is low; it does not eliminate the attack completely but makes it impractical |
| **COL-10** | A revoked B, but comes back with the decision "actually let B back in" - the cycle of re-keys is expensive | (UX/cost) | LWW: a subsequent invite is a new invitation flow (a fresh CEK, a fresh wrap for B). Acceptable if rare; a rate limit per resource (e.g. max 10 invite/revoke per resource per day) | A trade-off of simplicity vs efficiency; the expected pattern is low-frequency |

### 8.4 Permissions enforcement

| ID | Threat | Actor(s) | Proposed mitigation | Trade-off |
|---|---|---|---|---|
| **COL-11** | A recipient with a read-only role modifies the payload and sends re-encrypted ciphertext to the server | TA5 with a malicious motive | **In v1: a cooperative-trust model** - ALL recipients with access to the shared resource are edit-equal; the UI explicitly communicates "shared resources are cooperative". Read-only enforcement would require a digital signing layer (each edit signed with a per-author key; clients verify signatures on receive) - **out of scope for v1** (Q3, section 10.2). In the zero-knowledge model without a signing layer, a "read-only" role would be illusory protection; PII risk minimization through the deliberate choice of per-task / per-note granularity (who receives access to a specific resource) is the actual mitigation. Asymmetric permission roles are planned as v2 after the audit | Cooperative trust is simpler in v1, consistent with the mental model "I shared a specific resource with a specific person"; per-resource granularity replaces per-role granularity |
| **COL-12** | The per-subtask `assignee_user_id` (Reborn Task) is spoofed by server modification of `metadata_encrypted` | TA2 | Accepted residual risk for v1 - an integrity layer per-subtask assignment is out of scope (it would require a digital signing layer - out of scope for v1, Q3). Mitigation: the ciphertext is opaque to the server (modification = corrupt decrypt, legible to the client), so spoofing is at most a DoS. Enforcing the assignee for a subtask is planned as v2 after the audit | A low-impact trade-off; the assignee is a UX hint, not a security boundary |

### 8.5 Sharing graph & metadata correlation

| ID | Threat | Actor(s) | Proposed mitigation | Trade-off |
|---|---|---|---|---|
| **COL-13** | The server sees the full sharing graph (A -> B -> C -> ...) and can build the user's social network | TA1, TA9 | **Accepted** as an out-of-scope mitigation: full hiding of the graph requires PIR / anonymous credentials - out of scope for the current design phase. The mitigation in scope: the server sees the **fact** of an A->B share but **does not see the content** or the **weight of the relationship** (how often A and B share, how long their shared resources are; ciphertext padding per COL-15 limits the size signal) | Full graph anonymity = a separate scope (future work) |
| **COL-14** | Timing analysis (when A shares with B, how often) | TA1, TA3 | Accepted, no in-scope mitigation - real-time timing obfuscation significantly worsens UX, and the timing signal is weaker than content | Acceptable |
| **COL-15** | Ciphertext size leakage (B sees roughly the length of a note before decryption) | TA1 | Padding strategy: ciphertext padding to the nearest power of 2 (1KB, 2KB, 4KB, 8KB, 16KB...); a cap at a 750KB hard limit. Average overhead ~25% (acceptable for the typical use case) | A trade-off of storage vs metadata leakage; a reasonable baseline |

### 8.6 Invitation flow

| ID | Threat | Actor(s) | Proposed mitigation | Trade-off |
|---|---|---|---|---|
| **COL-16** | An invitation token forwarded by TA10 (e.g. a forward in a group chat) | TA7, TA10 | The token is one-time, single-recipient, time-limited (default TTL is an open decision - see Q6, preliminary 7 days, owner-configurable). After the first claim by the recipient (binding their identity public key), the token is expired (a server-side flag) | The limit is acceptable; the UX explicitly states "this link can be used only once" |
| **COL-17** | Invitation token leakage via the OOB channel (e.g. an SMS log at the operator) | TA10, TA9 | User education: recommended Signal / in-person / E2E email. The UX shows a short list of secure channels. We accept that the user may choose a weak channel = acceptable user error | A trade-off of security vs accessibility - it must work for the typical user |
| **COL-18** | Invitation accept by a malicious B (B provides a false identity, A has no path to verify) | TA2 (if the server modifies); TA5 (a legitimate but malicious B) | **v1: TOFU + the one-time, single-recipient out-of-band token (COL-16)** - A shares only with the holder of the invitation token, and the key seen at first accept is pinned (TOFU). In v1 there is **no** safety-number verification, so an active server (TA2) substituting B's key at first accept is an accepted residual risk. Manual fingerprint verification (a Signal-style safety number, A may refuse the accept on a mismatch) is planned **post-v1** | Consistent with COL-1: TOFU first-contact gap accepted in v1, closed post-v1 by the safety-number pattern |

### 8.7 Conflict resolution & state consistency

| ID | Threat | Actor(s) | Proposed mitigation | Trade-off |
|---|---|---|---|---|
| **COL-19** | Two recipients edit a shared resource offline at the same time, both sync after the network is restored | (legit usage) | LWW (Last-Writer-Wins) baseline, driven by `updated_at` in the ciphertext payload. An explicit UX warning: "If you and someone else edited this at the same time, the most recent save wins. Earlier edits may be lost." | CRDT is out of scope for the current design phase; LWW is acceptable for the typical use case (notes/tasks, not real-time docs) |
| **COL-20** | The server injects a false conflict (or denies a real conflict) to confuse the user | TA2 | Target mitigation: each edit is signed with the author's signing key; the sync process verifies the signatures | **Requires a signing layer - out of scope for v1** (Q3). In the cooperative-trust model we accept that a conflict can be faked; partially mitigated by the deliberate choice of recipient (per-task granularity); the signing layer is planned as v2 after the audit |
| **COL-21** | Storage quota exhaustion via shared resources (recipient B has access to A's resources, which count toward A's quota) | (resource abuse) | The quota counts **at the owner** always (A's resources in A's quota); the recipient does not consume their own quota for received shares. Snapshot precedent: active shares in Notes count toward the owner's quota (`SharedSnapshot.payload_encrypted` size); collaborative shared resources analogously | Acceptable; the owner-pays model is clear |

---

## 9. Out of scope (deliberately, with justification)

Each item below is a **real risk** but explicitly out of scope for this threat model / the current design phase. The justification delimits the scope and signals awareness.

### 9.1 Side-channel attacks

- **Timing analysis at the JavaScript engine level**: the size and time of crypto operations in the browser could in theory reveal key bits. The browser engine MUST implement constant-time crypto in `crypto.subtle` - that assumption is beyond our control.
- **Cache side channels (Spectre-class)**: out-of-process mitigations at the browser/OS level are out of scope for the application.
- **Memory side channels**: V8 can swap application memory to disk; out of scope for a web app (mitigation: lock memory pages - impossible from JavaScript).

### 9.2 Endpoint compromise

- **Malware on the user's device** (keylogger, screen scraper, a browser extension with malicious intent) - the client is assumed trusted. Client compromise = account compromise.
- **Evil maid attack** (an attacker has physical access to the user's locked device before login): mitigated by OS-level full-disk encryption, out of scope for the application.
- **Compromised browser** (modified V8, an exploit via an ad network): out of scope.

### 9.3 Network-level anonymity

- **Full hiding of the sharing graph** requires PIR (Private Information Retrieval) or mix networks - computationally expensive and out of scope for this document.
- **Tor / VPN integration**: compatibility with Tor is good (a static PWA), but a dedicated Tor hidden service is a separate scope (future work).

### 9.4 Quantum-resistant cryptography

- **Post-quantum migration**: the current primitives (AES-256, ECDH P-256, RSA if used in identity) are secure against classical computers in 2026 but vulnerable to quantum computers (Shor's algorithm for ECDH/RSA). Migration to PQC (Kyber, Dilithium) is a significant scope - planned as future work.

### 9.5 Real-time collaboration

- **CRDT-based concurrent editing** (like CryptPad, Etherpad): conflicts merged operationally, not LWW. Requires a significantly different crypto architecture - a separate scope (future work).

### 9.6 Hardware supply chain

- Hardware compromise (CPU, RAM) - out of scope for any web application.

### 9.7 Social engineering

- Phishing recipients at the OS level (fake login windows) - partially mitigated by branded gates in the shipped snapshot primitive, but not eliminated. User education as the primary mitigation.

### 9.8 Legal compulsion outside the EU

- The threat model assumes an operator in an EU jurisdiction (Poland, GDPR compliance). The model for legal compulsion by a non-EU jurisdiction (e.g. the US CLOUD Act) is analogous but requires a separate assessment - out of scope for this document.

### 9.9 The structural limitation of browser-based cryptography (malicious code delivery)

Every web application with client-side cryptography inherits a structural limit: the server operator (or anyone who compromises the server) can substitute the served JavaScript bundle, and a substituted client can export plaintext / keys before it encrypts anything (the classic critique "JavaScript Cryptography Considered Harmful", Ptacek 2011, accurately identifies this risk). We model the threat explicitly as **CORE-12** (section 6), with its defense-in-depth (SRI + Service Worker app-shell pinning) and the post-v1 mitigations requiring an external code-distribution channel (browser-extension verifier, reproducible builds + binary transparency log, native apps).

We accept this limit deliberately as a consequence of the PWA architecture choice, whose priorities are: zero-install (access from any browser without installation), cross-platform (one codebase for desktop / mobile), and no app-store gatekeepers (E2E-encrypted apps are regularly subject to arbitrary curation in Google Play / Apple App Store). A full solution requires the external code-distribution components listed in CORE-12 - natural directions for post-v1 development.

---

## 10. Open questions / decisions to be made during implementation

The questions below remain open at the end of v0.1. Each will be resolved during implementation and subjected to verification in the external audit.

### 10.1 Identity key hierarchy

- **Q1**: Should the per-user identity key be derived deterministically from the master key (PBKDF2 secondary derivation) or generated once at the first device unlock and wrapped with the master key?
  - The first: deterministic, no server-side state, but interdependence with the password (a password change = a change of the identity key = all shares require a re-wrap for the remaining recipients)
  - The second: stable across password changes, but requires `identity_key_wrapped` as a server field
  - **Decision: the second** - the identity key is generated once at the first device unlock and wrapped with the master key (`identity_key_wrapped` as a server field). Stability across password changes is critical for UX (a password change does not require re-wrapping all shared resources for all recipients) and allows deterministic recovery of access on a new device after entering the password. We accept the cost of one additional server field and the requirement of a one-time generation procedure at the first unlock; in exchange we avoid cascading re-wraps of shared resources on every password rotation. Validation of the specific generation parameters and the initialization procedure will take place in the external audit.

- **Q2**: Is a per-device session key required or is a per-user identity key sufficient?
  - Trade-off: per-device wrapping increases storage (one share for a user with 3 devices = 3 wrapped CEKs) and provides per-device revocation granularity, but adds a key layer absent from the own-data model
  - **Decision: a pure per-user identity key; CEK wrapping per-user only.** One wrapped CEK per recipient regardless of device count; storage stays manageable, and revocation works at the recipient level (re-keying covers all of a recipient's devices at once). We do not introduce per-device session keys or per-device revocation granularity: that would be asymmetric complexity relative to the core ZK model, which for own data already assumes that a compromised device means compromised access for that user. Accepted trade-off: no key isolation between a recipient's own devices - symmetric with the assumption already accepted for own data, not a regression. The decision will be validated in the external audit.

### 10.2 Signing layer

- **Q3**: Should a digital signing layer be added to v1 (each edit signed with the author's signing key)?
  - For: it enforces permission semantics (a read-only recipient cannot inject an edit into the shared-state stream), it allows mitigating threats COL-3 / COL-4 / COL-20, it gives a history of "who changed what"
  - Against: significant additional infrastructure (managing signing keys per author, signature verification on every operation, the size overhead of a signature in every version, designing the interface for the "invalid signature" state)
  - **Decision: out of scope for v1.** The default v1 model is cooperative trust among the invited participants; the signing layer is considered as v2 only after the audit, once the core flow is stable and independently verified
  - **Dependency consequence**: without a digital signing layer, **asymmetric permission roles (read-only / edit / admin) and enforcing the assignee for a subtask in Reborn Task are also out of scope for v1** - they would be illusory protection without cryptographic grounding. Planned as v2 after the audit

### 10.3 Re-encryption strategy

- **Q4**: Eager vs lazy re-encryption on revocation:
  - Eager: on revoke, A immediately generates a new CEK, re-encrypts the entire history (or the current state with LWW), broadcasts the new wrapped CEK to the remaining recipients. Cost: O(resource size + N recipients) per revoke
  - Lazy: the old CEK stays "dirty", on the next edit A generates a new CEK. Cost: zero until the next edit, but the revoked B can still read the "current state" until the next write
  - **Decision: eager re-encryption.** Access withdrawal is a deliberate, intentional user action - the semantics "clicking Revoke immediately withdraws access to the current state" must be true at the moment of the click, not only at the next save. Lazy re-encryption would create a window in which the revoked recipient still reads the current state of the resource - this would contradict the user's mental model and increase the attack surface of TA6 (recipient post-revocation). The cost of eager re-encryption O(resource size + N recipients) is acceptable: a single resource (per-task / per-note) has a typical size in kilobytes, the number of recipients in a small-team use case is small, and revoke is a rare operation. The atomicity of the server transaction (a new wrapped CEK for the remaining + a revocation flag for B in a single transaction) limits the COL-9 race window to the network propagation delay. Validation of the specific atomicity implementation in the external audit.

- **Q5**: What about historic versions of notes (the version-history feature in Notes)? Do we re-encrypt all versions or only the current one?
  - Preliminary preference: only the current state (version history at the owner's, never shared explicitly with B; B's local cache of historic content is already described as outside the revocation boundary)

### 10.4 Invitation token TTL

- **Q6**: The default TTL for the invitation token? 24h is the baseline in SaaS (Slack, Figma), but in the out-of-band channel model it is low (the user sends it on Signal, B reads it two days later after the weekend)
  - Preliminary preference: 7 days default + max 30 days configurable (with an explicit UX warning that a longer TTL = a larger attack window)

### 10.5 UX for post-revocation gaps

- **Q7**: How to communicate in the UX that revocation does not undo historic access?
  - Preliminary preference: a dedicated informational dialog at the first revoke per resource (with a "don't show again" option), plus a tooltip in the manage-shares dialog
  - Requires UX research for the typical user (not a cryptographer)

### 10.6 Brute-force resistance for the share password (collaborative)

- **Q8**: The snapshot primitive uses Argon2id on the share password. Collaborative shared resources do NOT use a password (the recipient has the master key). Do we need a share password as defense-in-depth for collaborative too? (E.g. an "extra password" required from B at first access)
  - Preliminary preference: NO - recipient B's master key + the per-recipient CEK wrap is sufficient; an extra password is user friction without a significant security gain

### 10.7 Server-side log redaction

- **Q9**: A runtime check for sensitive content in logs (CORE-4 hardening)?
  - Preliminary preference: yes, at the `createLogger` level in `@reborn/utils` - a regex check for strings that look like ciphertext (`${iv_b64}:${ciphertext_b64}`) or UUIDs in log args; raise in dev, suppress in prod. Additionally an ESLint rule blocking `logger.*(...err)` without a sanitize wrapper
  - Out of scope for v1, but to enter the backlog

### 10.8 Auth endpoint hardening (CORE-8, CORE-10, CORE-11)

- **Q11**: Should IP and User-Agent be bound to the payload HMAC in the PoW challenge (CORE-8 hardening)?
  - Currently the HMAC binds only `salt:challenge:difficulty:expiresAt`; the challenge can be used from any IP / UA within the 5-min TTL window (it is one-shot via `usedSalts`, so it expires after the first use)
  - For: a single challenge cannot be distributed across a pool of bots; minimal cost (one additional concat + verify); requires including request headers in the `signChallenge` payload
  - Against: a marginal complication of the flow for legit users behind NAT (an IP change between `/api/pow/challenge` and `/api/auth/register` is rare but possible); a UA change via an intermediary proxy also happens rarely
  - Preliminary preference: yes, add it to the payload HMAC. Validation of the specific headers to bind (whether only IP, or IP + UA, or also `Accept-Language`) in the external audit

- **Q12**: Should the response message for a username collision be unified with the other bot-protection failures and the timing equalized (CORE-10, CORE-11 hardening)?
  - Argument for: it eliminates the body oracle (a different error string) and the timing oracle (a DB lookup after PoW verify) for username enumeration on the registration endpoint and analogously on the login endpoint (per-username lockout)
  - Argument against: `username` is deliberately Tier 4 server-visible in the core ZK model (section 2.4) - "username exists" technically reveals something that is server-visible anyway via the collision check at the DB level. Full unification means a UX degradation (the user does not know whether the username is taken before clicking Submit)
  - Preliminary preference: partial unification - return a unified `"Registration failed"` for all pre-DB failures (honeypot / timing / PoW), keep a distinct `"Username already taken"` for a DB collision **only after** passing all bot-protection gates; add a dummy Argon2id on the collision path to equalize the timing relative to the success path. For the login lockout: consider keying the lockout per `(ip, username_hash)` with a dummy lockout for non-existent accounts. Validation of the specific implementation in the external audit

### 10.9 Code delivery hardening (PWA structural limit)

- **Q13**: Implement the cheap defense-in-depth for malicious code delivery (CORE-12, section 9.9) - Subresource Integrity (SRI) + Service Worker app-shell pinning?
  - Preliminary preference: yes for both, explicitly documented as defense-in-depth, not a solution to the structural limit (SRI does not protect the HTML / entry bundle; SW pinning needs an explicit "update available" UX). The specific implementation (which `<script>` tags get SRI, the SW update flow / UX) to be validated in the external audit
  - **Related post-v1**: a browser-extension verifier (the Code Verify / Signal Desktop pattern), reproducible builds + a binary transparency log

### 10.10 Audit-driven re-evaluation

- **Q10**: After external audit findings - a reorganization of the threat model vs incremental updates?
  - Plan: v0.1 (this draft) -> ad-hoc updates during the implementation of the collaborative protocol -> v1.0 after the external audit and retest cycle
  - A major reorganization is acceptable if the audit findings indicate that the current taxonomy is suboptimal

---

## 11. Document status and version map

| Version | Date | Contents | Status |
|---|---|---|---|
| **v0.1** | May 2026 | The first public draft. Covers the core ZK + the shipped snapshot + the collaborative protocol scope. The open questions from section 10 are unresolved | **This document** - published as a pre-implementation artifact |
| Updates in between | Crypto/server/UI implementation phases | Ad-hoc updates on design decisions during implementation | Planned |
| **v1.0** | After the external audit + retest cycle | The final version after the external audit; integration of findings; published as a stable artifact | Planned |

### 11.1 Feedback channel

After the v0.1 publication as a public artifact - feedback is accepted via:
- GitHub issues in the main repo (and a GitHub private security advisory for vulnerability reports - see `SECURITY.md`)
- Email security@reapps.eu; PGP key for encrypting reports: fingerprint `43C7 FFE6 8AA0 C5E9 0E5A 4568 58DB 096C 16C1 2029`, public key: https://reapps.eu/.well-known/pgp-key.asc (in the repo: [`docs/security/pgp-key.asc`](https://github.com/fundacja-reborn/reapps/blob/main/docs/security/pgp-key.asc), also described in `SECURITY.md`; `security.txt` RFC 9116: https://reapps.eu/.well-known/security.txt)

---

## Reference appendices

- [`docs/security/security-overview.md`](https://github.com/fundacja-reborn/reapps/blob/main/docs/security/security-overview.md) - the project's public security overview
- [`docs/security/read-only-snapshot-sharing.md`](https://github.com/fundacja-reborn/reapps/blob/main/docs/security/read-only-snapshot-sharing.md) - the shipped snapshot primitive design (a reference for SNAP-* threats)
- [`docs/architecture/zero-knowledge-architecture.md`](https://github.com/fundacja-reborn/reapps/blob/main/docs/architecture/zero-knowledge-architecture.md) - the core ZK model

Internal design documentation and internal security-review reports remain internal and are not published.
