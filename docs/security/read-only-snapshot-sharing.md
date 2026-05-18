# Read-only Snapshot Sharing - Zero Knowledge Design

This document describes the design of the read-only snapshot sharing primitive shipped in Reborn Apps in May 2026 (release v0.23.0+). It covers what the feature does for the user, why it remains Zero Knowledge, and the technical details of how the encryption, server contract, and defence-in-depth mechanisms work.

> Originally published on the project blog at [reapps.eu/blog/sharing-notes-tasks-zero-knowledge-snapshots](https://reapps.eu/blog/sharing-notes-tasks-zero-knowledge-snapshots/) (2026-05-16). Mirrored here as a stable reference artefact for the project repository.

---

In **Reborn Task** and **Reborn Notes**, a read-only public link to a single note or task can now be generated. Simply click "Share" to receive a URL that can be pasted into a chat, sent via email, or printed as a QR code. Anyone with that URL can read the snapshot in their browser without an account.

The most important part is what does **not** change: the server hosting the application still cannot read the shared content. The architecture is built on the same Zero Knowledge model that protects private data. It has been extended in a way that keeps the server "blind" even though the data is now reachable from the public internet.

This post is divided into two parts. The first part explains the feature in plain terms: what the feature does, **how to secure the link with a password**, why the technology remains safe, and what can be configured. The second part is for readers who want the technical deep dive: how the key travels, what the server sees, and the defense-in-depth protections implemented.

## Part 1: The feature in plain terms

### What can be shared and how to protect it

A single note or a single task can be shared, together with its subtasks. The shared copy is a **snapshot**: a frozen-in-time picture of the content at the moment the link was created. If the original is edited later, the snapshot does not change. If the user changes their mind, the link can be revoked at any time.

When creating a share, the following can be configured:
- Just the title and content (the minimum).
- Optionally a "display name" - a different label than the original file title.
- Optionally a "shared by" label - a short string identifying the sender (e.g., a first name) shown on the public page.

**Password Protection (Highly Recommended)**
While the link itself acts as a credential, **best practice dictates adding a password** when creating the share. This is the only piece of information the server actively verifies (via a strong Argon2id hash). The recipient must enter it before their browser receives the encrypted data. 10 wrong attempts rate-limit the IP, protecting against brute-force attacks, but this does *not* consume the "max opens" counter.

All active shares can be managed from **Settings -> Security -> Shares**, and from a small badge that appears in the header of any active note or task.

### Why this is still Zero Knowledge

Reborn Apps is built on a strict rule: **the server never sees data in plaintext**. Every note, every task title, and every tag association is encrypted on the device before it ever leaves it.

When a share is created, the same rule applies, but a key mechanism was introduced. Instead of using the private master key (which is unique to the account and never leaves the device), the application generates a **brand new, single-purpose encryption key** specifically for this one link. It encrypts the snapshot with that key, sends the encrypted blob to the server, and embeds the key directly **in the URL** - in the part after the `#` character (the fragment).

That little detail is what makes the whole mechanism work safely. Web browsers, by design, **never send the part after `#` to the server**. It stays purely on the user's device. So when a recipient clicks the link:

1. Their browser asks the server for the encrypted blob (using the path before the `#`).
2. The server returns the ciphertext, exactly as it does with private notes.
3. The browser takes the key from the part after the `#`, decrypts the file locally, and renders the content for the recipient.

The server acts solely as a storage and delivery mechanism and never comes into possession of the key. Even in the event of a total database breach, an attacker would find only encrypted blobs and no decryption keys.

### "But anyone with the link can read it - is that really safe?"

If a share is created **without** a password, the answer is yes: anyone who has the full URL (including the fragment after the `#`) can read the snapshot. This is a deliberate design called the **capability URL** pattern (the link itself is the credential), used previously by services like Bitwarden Send or Firefox Send.

This approach is highly secure because:
- Without the part after `#`, even the server cannot decrypt the snapshot.
- Server access logs (e.g., Nginx) do not contain the fragment.
- Navigating away via an external link sets a strict `Referrer-Policy`, preventing source URL leaks.
- The link entropy is massive (96 bits of randomness in the slug, 256 bits in the key), making guessing statistically impossible.

In short: possession of the full link is the access control. Treat an unpassworded link like the key itself. If pasted into a private chat, only that person can read it. For public posting or sensitive data, **always use the password feature**.

### What else can be configured

When creating a share, the following options are available:

| Setting | What it does |
|---|---|
| **Password** (optional, recommended) | The recipient must enter it before the server releases the snapshot. Verified via an Argon2id hash on the server. |
| **Expiry** (optional) | The link expires at a chosen time (minutes to a year). Upon expiry, the encrypted blob is hard-deleted from the server. |
| **Maximum opens** (optional) | After `N` successful opens, the link automatically self-revokes ("read and destroy" mode). |
| **Display name** (optional) | An alternative title visible to the recipient. Stored inside the encrypted payload (the server does not see it). |
| **"Shared by" label** (optional) | A sender identifier. Also stored inside the encrypted payload. |

### Where the encryption actually happens

Data flow overview:
- **On the device, during creation**: A fresh AES-GCM 256-bit key is generated. The snapshot is encrypted with it. The key itself is then wrapped (encrypted) with the master key (so the owner can manage shares across devices). Both encrypted files go to the server.
- **On the server**: The database stores the ciphertext, the wrapped key, the password hash, the expiry date, and the open counter. The server cannot decrypt any of these values.
- **On the recipient's device (opening)**: The browser downloads the ciphertext, grabs the key from the URL fragment, and decrypts the content locally. The entire process requires zero accounts, zero cookies, and zero IndexedDB footprint.
- **On the owner's devices (preview)**: The application downloads the ciphertext and wrapped key, unwraps it locally with the master key, and shows the preview. This local preview bypasses the public endpoint and does *not* consume the open limit.

---

## Part 2: The technical details

This section is for readers curious about the system architecture, cryptography, and defense-in-depth.

### The URL format

```text
https://reapps.eu/notes/s/<slug>#k=<base64url_key>&v=1
https://reapps.eu/task/s/<slug>#k=<base64url_key>&v=1
```

* `slug` is 16 base64url characters (96 bits of entropy via `crypto.getRandomValues`). Brute-force enumeration is statistically impossible and actively rate-limited.
* `k` is the AES-GCM 256-bit key (32 raw bytes, 43 base64url characters without padding).
* `v` is the payload format version (currently `1`), allowing graceful backward compatibility for future encrypted JSON schemas.

Per RFC 3986 §3.5, the fragment (after `#`) is purely client-side. It never enters the network boundary, access logs, or the Service Worker.

### Encryption mechanics

* The per-share one-time key is generated via the Web Crypto API: `crypto.getRandomValues(new Uint8Array(32))`.
* The data (payload) uses AES-GCM with a fresh 12-byte IV per encryption, stored as `iv:ciphertext` (base64). This exact format allows the global regex **Encryption Guard** to block any plaintext leaks at the network edge.
* The owner's master key is solely used for local key wrapping operations and **never leaves the device**.

### What the server actually stores

| Field | Plaintext? | Why |
| --- | --- | --- |
| `slug` | Yes | Public path identifier |
| `user_id` | Yes | Foreign key for UI management |
| `snapshot_type` | Yes | Distinguishes `note` / `task` to not mix shares in the UI |
| `created_at`, `expires_at`, `revoked_at` | Yes | Database cleanup and UI timestamps |
| `access_count`, `max_access_count` | Yes | Operational tracking counter |
| `password_hash` | Yes (Argon2id) | Server-side password verification |
| `payload_encrypted` | **No** | Main AES-GCM ciphertext |
| `owner_key_wrapped` | **No** | Share key wrapped by the account's master key |
| Source ID, Title, Body, Subtasks | **No** | Strictly inside `payload_encrypted` |

Notice that even the `source_id` mapping the share to a specific note is encrypted. This makes it impossible for the server to profile which specific notes are shared frequently.

### Defense-in-depth: Payload minimization

When generating the encrypted snapshot, organizational metadata is proactively stripped:

* Notes lose the `is_starred`, `is_pinned`, `tags` flags, and update timestamps.
* Tasks lose the `reminder_date`, recurrence rules, and notification flags.
* Decryption relies on strict Zod schemas that automatically drop unknown fields. The recipient receives exactly the context required to read the snapshot, and nothing more about the organizational workflow.

### Atomic "max opens" enforcement

Limiting access to a strict `N` opens inherently risks race conditions under concurrent requests.

This is solved with a single locking PostgreSQL operation: `UPDATE ... WHERE access_count < max_access_count AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) RETURNING ...`. The statement guarantees atomicity, returning either the payload or a `410 Gone` error (distinguishing between `EXHAUSTED`, `EXPIRED`, or `REVOKED`). The statement updates `revoked_at = NOW()` on the final permitted read, triggering the standard cleanup pipeline.

Failed password attempts are rejected early in the controller stack, preventing the open limit from being wasted.

### True anonymity for viewers

Visiting `/s/<slug>` triggers a strict stateless architecture without logging in:

* Service Workers intercept and bypass the `/s/*` and `/api/shares/*` routes entirely before any cache logic.
* The `hooks.client.ts` component halts standard storage initialization and session listeners for these paths.
* Locale detection sets `persistPreference: false`, avoiding any data being saved in `localStorage`.
* Cross-origin fetches operate with `credentials: 'omit'` (ignoring any existing session cookies).

Opening a public share in incognito mode and closing it leaves zero footprint aside from a potential entry in the local browser history.

### Protecting the recipient

**Anti-phishing:** All access gates and error screens are rendered through a standardized `ShareGate` component. Branded error pages link safely back to `reapps.eu` (or the self-hosted domain), visually distinguishing authentic application limits from external credential harvesting attempts.

**Markdown Sanitization:** Every unencrypted Markdown content is converted to HTML via `marked` paired with the **DOMPurify** library using a strict URI allowlist. Formats like `javascript:` and `data:` are purged. Robust nonce-based Content Security Policy (CSP) headers provide additional protection.

**Image isolation:** The snapshot view defaults to blocking external graphics ("ask before loading"). This prevents the recipient from inadvertently leaking their IP address to third-party servers hosting tracking pixels or media.

### Rate limits

* `POST /api/shares` (create): 30 requests per hour per user (abuse deterrence for the hosting).
* `GET /api/shares/<slug>` (unauthenticated read): 100 per minute per IP (handles viral links from newsletters).
* Incorrect share password: A dedicated limit of 10 attempts per 15 minutes (does not impact the main account login attempts within the same network).

### Lifecycle and cleanup

* **Revoke** triggers a soft delete. The encrypted blob remains in the database for 24 hours (a buffer for accidental revokes) before being **hard-deleted** by background workers.
* Expirations are treated as hard deletes immediately upon passing `expires_at`.
* Instead of heavy cron jobs, background sweeps are "lazy": 0.5% of standard HTTP requests naturally trigger the cleanup procedure for old entries.
