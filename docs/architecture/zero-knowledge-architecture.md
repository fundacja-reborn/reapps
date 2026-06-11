# Zero Knowledge Architecture - Reborn Apps

## Core Principles

Reborn Apps is built on a **True Zero Knowledge** architecture, meaning:

1. **The server holds no personal data about users**
   - No email field in the database
   - No phone number or other contact information
   - The only plaintext identifier is `username` (required for uniqueness)

2. **All user data is end-to-end encrypted**
   - Task and note titles
   - Descriptions and content
   - List, folder, and tag names
   - User preferences
   - Even metadata (colors, icons)
   - **Sensitive behavioral metadata** - `is_completed`, `is_starred`, `due_date`, `reminder_date`, `is_pinned`, tag↔note associations - hidden inside an encrypted `metadata_encrypted` field (JSON → AES-GCM). The server sees only an opaque cipher string
   - **Session device information** - `device_info_encrypted` in `UserSession` and `UserWebPushSubscription` - parsed User-Agent (e.g., "Chrome · Windows") encrypted with AES-GCM on the client. The server does not know the device type or browser

3. **Encryption keys never leave the device**
   - The master key is generated locally
   - The server stores only an encrypted version of the master key
   - The user's password is never sent to the server

## User Data Structure

```typescript
interface User {
  id: string;                    // UUID
  username: string;              // Only plaintext identifier
  password_hash: string;         // Argon2id hash (legacy PBKDF2 supported)
  master_key_encrypted: string;  // Encrypted master key (AES-GCM, wrapped via PBKDF2 600K)
  master_key_salt: string;       // Salt for key derivation
  settings_encrypted?: string;   // Encrypted user settings
  created_at: Date;
  updated_at: Date;
}
```

## Server Visibility Model

In a Zero Knowledge model, there is a boundary between **relational structure** (needed by the server for indexing, authorization, and sync) and **content** (always encrypted). The table below documents deliberate decisions about what remains in plaintext as relational keys.

| Field | Server visibility | Rationale |
|---|---|---|
| `id` (UUID) | Plaintext | Primary key of every entity. Required for sync addressing. |
| `user_id` | Plaintext | FK to `User`. Required for ownership-based authorization. |
| `task_list_id` / `folder_id` / `parent_task_id` / `parent_id` | Plaintext (FK) | **The server sees the tree structure** (which task belongs to which list, which note to which folder). This is deliberate - the server must handle cascade deletions, per-list/folder authorization, and per-parent sync sorting. **The server does not know the names** of lists or folders (`name_encrypted`). |
| `tag_ids` (note↔tag relation) | **Hidden inside `metadata_encrypted`** | Deliberately different from `folder_id`: a many-to-many tag relation would be a strong correlation analysis channel (which notes share tags → topical graph → behavioral fingerprint). There is no `NoteTag` table on the server - the full list of tag IDs is part of `NoteSensitiveMetadata`, encrypted alongside the note. |
| `created_at` / `updated_at` | Plaintext | Required for sync (delta pull, conflict resolution). Reveals activity patterns over time, but not content. |
| `position` | Plaintext | List ordering. A number without context. |
| `metadata_encrypted` | Ciphertext | Bundle of sensitive behavioral metadata (`is_completed`, `is_starred`, `due_date`, `is_pinned`, `tags`, etc.) encrypted as a single JSON object. The server sees an opaque cipher. |
| `SavedSearch.query_encrypted` / `name_encrypted` / `metadata_encrypted` | Ciphertext | Saved searches (smart folders) store the user's query string, display name and behavioral metadata (e.g. the search-in-content toggle) encrypted. The server never sees which operators, tags, or phrases a saved view filters by - nor which views scan note bodies; evaluation happens exclusively client-side through the same parser as live search. The metadata bundle is written for **every** row (also for default values), so its mere presence cannot leak the toggle state. The server sees only **how many** saved searches exist and the optional `folder_id` they are pinned to (a FK already visible per the tree-structure row above). |
| `*_encrypted` (e.g., `title_encrypted`, `name_encrypted`, `content_encrypted`) | Ciphertext | All user-visible text data. |

### Why `folder_id` is plaintext but `tag_ids` are encrypted

- **`folder_id`** is a **1-to-N** relation (a note has exactly one folder, a folder has N notes). Similar to `task_list_id`, the server needs this for cascade operations (folder deletion, note relocation) and per-parent sync. The leaked information is: "this user has N folders, folder X contains M notes." It reveals neither content nor inter-note relationships.
- **`tag_ids`** is an **N-to-M** relation. If it existed in plaintext as a `NoteTag(note_id, tag_id)` table, the server could build a graph of "which notes share tags" - a short step from a topical fingerprint of the user, even without knowing tag names. For this reason, the full `tag_ids` list lives inside `metadata_encrypted` and does **not** exist on the server as a separate relational table. Tag names (`tags.name_encrypted`) are encrypted independently.

**Practical consequences:**

- Filtering/sorting by folder can be performed server-side (standard WHERE/INDEX).
- Filtering by tags **must** happen client-side after decrypting `metadata_encrypted` (or from the in-memory `NoteIndex`).
- Any new relation with similar correlation risk (e.g., "related notes") should go into `metadata_encrypted`, **not** as a separate table.

## Account Recovery

Since no email is stored, account recovery relies on:

1. **Recovery Codes**
   - 8 codes generated at registration (`XXXXX-XXXXX` format)
   - **Hashed with SHA-256 before server-side storage** - the server never sees the plaintext codes
   - Single-use only - each code is deleted after successful use
   - The user is solely responsible for storing them securely

## Authentication Flow

1. **Registration**

   ```
   1. User provides username and password
   2. Client solves a Proof-of-Work challenge (HMAC-SHA256)
   3. A master key is generated locally
   4. The master key is encrypted with the user's password
   5. Sent to the server:
      - username
      - password hash (Argon2id)
      - encrypted master key
      - PoW solution
   ```

   > **Why PoW instead of CAPTCHA?** Traditional CAPTCHAs (reCAPTCHA, hCaptcha) send data to third-party servers, which contradicts the Zero Knowledge principle. PoW is self-contained - no external tracking, no cookies, no fingerprinting.

2. **Login**
   ```
   1. User provides username and password
   2. Server returns the encrypted master key
   3. The master key is decrypted locally using the password
   4. All data is decrypted locally
   ```

## Encryption Guard

To enforce the Zero Knowledge contract at the code level, all data leaving the client passes through a **3-layer encryption validation** pipeline:

1. **Post-encrypt** - validates ciphertext format (`iv:ciphertext`, Base64) immediately after encryption
2. **Pre-save** - validates before writing to IndexedDB
3. **Pre-sync** - validates before sending to the server

This defense-in-depth approach ensures that plaintext data cannot accidentally be persisted or transmitted due to an encryption failure or a programming error.

## Cross-Device Sync

- Each device has its own refresh token
- Data is encrypted before transmission
- The server is merely a "dumb" storage of encrypted data
- Conflicts are resolved client-side

## Architectural Consequences

### Benefits

- Absolute user privacy
- No data to leak in case of a server breach
- GDPR compliance "by design"
- User trust

### Design Trade-offs

These are deliberate architectural decisions that follow directly from the Zero Knowledge model - they are the cost of true end-to-end privacy:

- **No account recovery without recovery codes** - because the server cannot decrypt user data, there is no "forgot password" flow. Recovery codes are the only fallback
- **No email-based notifications** - because no email is stored. Push notifications are supported instead
- **Support cannot access or recover user data** - by design, the server holds only ciphertext
- **The user is the sole custodian of their data** - full ownership also means full responsibility

## Note: AES-GCM Birthday Bound

AES-GCM with a 96-bit IV (12 bytes, randomly generated) has a limitation known as the **birthday bound**: after ~2^32 (~4.3 billion) encryptions with the same key, the probability of IV collision becomes dangerously high, which could result in plaintext disclosure.

**In the context of Reborn Apps:**

- Each user has their own master key → the limit applies per-user
- A typical user performs ~100 encryptions/day (creating/editing tasks and notes)
- At 100 ops/day: ~43 million years to reach the limit
- **Conclusion**: at the current usage scale, the risk is effectively zero. Key rotation is not required - this aligns with the industry standard for E2E apps (Signal, Proton, 1Password, Bitwarden). Changing the password re-wraps the master key with a new PBKDF2 derivation

---

*This architecture is the security foundation of Reborn Apps. For the full security posture, see the [Security Overview](../security/security-overview.md).*
