import { z } from 'zod';
import type { SubtaskSensitiveMetadata } from './entities/task';

// ─── Format constants ────────────────────────────────────────────────

/** Snapshot payload schema version. Bump on breaking shape change. */
export const SNAPSHOT_PAYLOAD_VERSION = 1;

/** Length of public slug (base64url chars, ~96 bits of entropy from 12 random bytes). */
export const SHARE_SLUG_LENGTH = 16;

/** Default expiry options (seconds). null = no expiry. */
export const SHARE_EXPIRY_PRESETS = {
  '1d': 86_400,
  '7d': 7 * 86_400,
  '30d': 30 * 86_400,
  never: null
} as const;

/** Default expiry when caller does not specify. Mirrors Bitwarden Send. */
export const SHARE_DEFAULT_EXPIRY_SECONDS = SHARE_EXPIRY_PRESETS['7d'];

/** Max length of optional sender label included in payload. */
export const SHARE_SENDER_LABEL_MAX_LENGTH = 40;

/**
 * Max length of optional display name included in payload. Display name is the
 * label shown in the snapshot viewer header in place of the source note/task
 * title - lets the sender share without leaking a sensitive original title
 * (e.g. "Bank passwords.md") while still giving the recipient context.
 *
 * Lives inside the encrypted payload, so the server never sees it.
 */
export const SHARE_DISPLAY_NAME_MAX_LENGTH = 80;

/** Hard upper bound for `max_access_count`. Beyond this an unlimited share makes more sense. */
export const SHARE_MAX_ACCESS_COUNT_LIMIT = 1000;

/** Max bytes of encrypted payload (~500 KB plaintext + AES-GCM overhead). */
export const MAX_SHARE_PAYLOAD_BYTES = 750_000;

/** Max bytes of wrapped key blob (32 bytes key + IV + base64). */
export const MAX_SHARE_OWNER_KEY_WRAPPED_BYTES = 200;

// ─── Encryption Guard regex ──────────────────────────────────────────
//
// Matches `iv:ciphertext` where both segments are non-empty Base64 (standard).
// Same shape as other `*_encrypted` fields in the codebase.
const ENCRYPTED_BLOB_REGEX = /^[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;

const encryptedBlob = (maxBytes: number) =>
  z
    .string()
    .min(3, 'Encrypted blob too short')
    .max(maxBytes, 'Encrypted blob exceeds size limit')
    .regex(ENCRYPTED_BLOB_REGEX, 'Encrypted blob must match iv:ciphertext (Base64) format');

// ─── Payload (after decryption, never seen by server) ────────────────
//
// Defense-in-depth: the snapshot payload is a DELIBERATELY MINIMAL subset of
// the source note/task. We only ship fields the recipient actually needs to
// render the snapshot. Personal organisational metadata (is_starred,
// is_pinned, tags, reminder_date), app-internal state (notification_sent,
// completed_at, completed_occurrences_count, recurrence_*), and timestamps
// with low recipient value (created_at/updated_at) are intentionally absent.
//
// Rationale: encrypted payloads are server-opaque BUT recipient-readable
// after client-side decryption. Anything we ship leaks once the recipient has
// the URL fragment key. The zero-knowledge promise stops at the recipient -
// the user picks who that is, so we minimise what they learn beyond the
// content the sender meant to share.
//
// Adding a field here should be a deliberate choice tied to a recipient-side
// rendering need, not "we might want this later". If you're tempted to add
// one, ask: does removing it visibly break what the recipient sees? If no,
// it doesn't belong.

/**
 * Minimal task-level metadata included in the snapshot.
 * - `due_date` / `has_time`: rendered as "Due 10.04.2026" below the title
 * - `is_completed`: drives line-through styling and the "Completed" badge
 */
export interface SharedSnapshotTaskMetadata {
  due_date?: string | null;
  has_time?: boolean;
  is_completed?: boolean;
}

/** Note snapshot payload. Encrypted by the client into payload_encrypted. */
export interface SharedSnapshotNotePayload {
  type: 'note';
  v: typeof SNAPSHOT_PAYLOAD_VERSION;
  title: string;
  content: string;
  shared_at: string;
  shared_by_label?: string;
  /** See SHARE_DISPLAY_NAME_MAX_LENGTH. Falls back to `title` when absent. */
  display_name?: string;
  /**
   * UUID of the source note this snapshot was created from. Lives inside the
   * ciphertext (server never sees it). Owner-only - used by the client to
   * surface "this note has N active shares" indicators next to the source
   * without hitting the public endpoint. Optional for backward compat with
   * shares created before this field existed.
   */
  source_id?: string;
}

/** Task snapshot payload (single task with subtasks inline). */
export interface SharedSnapshotTaskPayload {
  type: 'task';
  v: typeof SNAPSHOT_PAYLOAD_VERSION;
  title: string;
  description?: string;
  metadata: SharedSnapshotTaskMetadata;
  subtasks: Array<{
    name: string;
    metadata?: SubtaskSensitiveMetadata;
  }>;
  shared_at: string;
  shared_by_label?: string;
  /** See SharedSnapshotNotePayload.display_name - same role, for tasks. */
  display_name?: string;
  /** See SharedSnapshotNotePayload.source_id - same role, for tasks. */
  source_id?: string;
}

export type SharedSnapshotPayload = SharedSnapshotNotePayload | SharedSnapshotTaskPayload;

/**
 * Zod schema for snapshot payload (post-decryption validation).
 * Discriminated union on `type`. v must equal SNAPSHOT_PAYLOAD_VERSION.
 */
export const SharedSnapshotPayloadSchema: z.ZodType<SharedSnapshotPayload> = z.discriminatedUnion(
  'type',
  [
    // Strict schemas (no .passthrough()) implement defense-in-depth at the
    // parse layer: legacy bloated payloads still validate, but Zod strips
    // unknown fields out of the result. Even if a future sender forgets to
    // filter, the recipient never sees the extras after .safeParse().
    z.object({
      type: z.literal('note'),
      v: z.literal(SNAPSHOT_PAYLOAD_VERSION),
      title: z.string().max(1000),
      content: z.string().max(500_000),
      shared_at: z.string(),
      shared_by_label: z.string().max(SHARE_SENDER_LABEL_MAX_LENGTH).optional(),
      display_name: z.string().max(SHARE_DISPLAY_NAME_MAX_LENGTH).optional(),
      source_id: z.string().max(64).optional()
    }),
    z.object({
      type: z.literal('task'),
      v: z.literal(SNAPSHOT_PAYLOAD_VERSION),
      title: z.string().max(1000),
      description: z.string().max(10_000).optional(),
      metadata: z.object({
        due_date: z.string().nullable().optional(),
        has_time: z.boolean().optional(),
        is_completed: z.boolean().optional()
      }),
      subtasks: z
        .array(
          z.object({
            name: z.string().max(1000),
            metadata: z
              .object({
                is_completed: z.boolean().optional()
              })
              .optional()
          })
        )
        .max(500),
      shared_at: z.string(),
      shared_by_label: z.string().max(SHARE_SENDER_LABEL_MAX_LENGTH).optional(),
      display_name: z.string().max(SHARE_DISPLAY_NAME_MAX_LENGTH).optional(),
      source_id: z.string().max(64).optional()
    })
  ]
) as unknown as z.ZodType<SharedSnapshotPayload>;

// ─── API: POST /api/shares ───────────────────────────────────────────

/** Body of POST /api/shares — server stores 1:1, never decrypts. */
export const CreateShareRequestSchema = z.object({
  payload_encrypted: encryptedBlob(MAX_SHARE_PAYLOAD_BYTES),
  owner_key_wrapped: encryptedBlob(MAX_SHARE_OWNER_KEY_WRAPPED_BYTES),
  expires_in_seconds: z
    .number()
    .int()
    .positive()
    .max(365 * 86_400) // hard cap 1 year
    .nullable()
    .optional(),
  password: z.string().min(8).max(200).optional(),
  max_access_count: z
    .number()
    .int()
    .min(1)
    .max(SHARE_MAX_ACCESS_COUNT_LIMIT)
    .nullable()
    .optional()
});
export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>;

/** Response of POST /api/shares — slug used to construct public URL. */
export interface CreateShareResponse {
  id: string;
  slug: string;
  created_at: string;
  expires_at: string | null;
  max_access_count: number | null;
}

// ─── API: GET /api/shares/{slug} (public, no auth) ───────────────────

/**
 * Public view response. NEVER includes owner_key_wrapped.
 * If password is set and X-Share-Password header is absent or wrong:
 *   - returns { password_required: true } (200) — UX, not auth failure
 */
export interface ShareViewResponse {
  password_required: false;
  payload_encrypted: string;
  expires_at: string | null;
  created_at: string;
  /** Post-increment value: the count including the read that produced this response. */
  access_count: number;
  /** NULL = unlimited. When non-null and `access_count` reaches this value, the share is exhausted (auto-revoked). */
  max_access_count: number | null;
}

export interface SharePasswordRequiredResponse {
  password_required: true;
}

export type SharePublicResponse = ShareViewResponse | SharePasswordRequiredResponse;

/** Discriminator for 410 Gone responses so the client can render dedicated copy. */
export type ShareGoneCode = 'REVOKED' | 'EXPIRED' | 'EXHAUSTED';

export interface ShareGoneErrorBody {
  success: false;
  error: string;
  code: ShareGoneCode;
}

// ─── API: GET /api/shares (list own, auth required) ──────────────────

/**
 * Snapshot origin app. Plaintext metadata for listing scope - the value
 * tells us which app created the share (notes vs task) so each app's
 * settings page only renders its own shares. NOT a content classification:
 * the actual payload type is inside the ciphertext (server cannot see it).
 *
 * 'unknown' is a backfill value for rows created before this column existed.
 */
export const SNAPSHOT_TYPES = ['note', 'task', 'unknown'] as const;
export type SnapshotType = (typeof SNAPSHOT_TYPES)[number];
export const SnapshotTypeSchema = z.enum(SNAPSHOT_TYPES);

/**
 * Listing item for the owner. Includes owner_key_wrapped so the client
 * can reconstruct the URL on any device, and payload_encrypted so the
 * owner can decrypt locally to render title/preview without hitting the
 * public endpoint (which would consume an access slot). The wrapped key
 * and ciphertext are useless without the master key.
 */
export interface OwnShareListItem {
  id: string;
  slug: string;
  snapshot_type: SnapshotType;
  owner_key_wrapped: string;
  payload_encrypted: string;
  has_password: boolean;
  expires_at: string | null;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number;
  max_access_count: number | null;
  revoked_at: string | null;
}

export const OwnShareListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  snapshot_type: SnapshotTypeSchema,
  owner_key_wrapped: z.string(),
  payload_encrypted: z.string(),
  has_password: z.boolean(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  last_accessed_at: z.string().nullable(),
  access_count: z.number().int().nonnegative(),
  max_access_count: z.number().int().positive().nullable(),
  revoked_at: z.string().nullable()
});

export const OwnSharesListResponseSchema = z.object({
  shares: z.array(OwnShareListItemSchema)
});
export type OwnSharesListResponse = z.infer<typeof OwnSharesListResponseSchema>;

// ─── Slug validation (used by route param parser) ────────────────────

/**
 * Slug format: 16 base64url chars (no padding). Matches output of
 * `arrayBufferToBase64(bytes12, urlSafe=true)`.
 */
export const SLUG_REGEX = /^[A-Za-z0-9_-]{16}$/;
export const SlugSchema = z.string().regex(SLUG_REGEX);
