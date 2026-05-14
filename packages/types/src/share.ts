import { z } from 'zod';
import type { NoteSensitiveMetadata } from './entities/note';
import type { TaskSensitiveMetadata, SubtaskSensitiveMetadata } from './entities/task';

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

/** Note snapshot payload. Encrypted by the client into payload_encrypted. */
export interface SharedSnapshotNotePayload {
  type: 'note';
  v: typeof SNAPSHOT_PAYLOAD_VERSION;
  title: string;
  content: string;
  metadata?: NoteSensitiveMetadata & {
    created_at?: string;
    updated_at?: string;
    /** Author's image-load preference for external images (mirrors O25). */
    image_mode?: 'always' | 'never' | 'ask';
  };
  shared_at: string;
  shared_by_label?: string;
}

/** Task snapshot payload (single task with subtasks inline). */
export interface SharedSnapshotTaskPayload {
  type: 'task';
  v: typeof SNAPSHOT_PAYLOAD_VERSION;
  title: string;
  description?: string;
  metadata: TaskSensitiveMetadata;
  subtasks: Array<{
    name: string;
    metadata?: SubtaskSensitiveMetadata;
  }>;
  shared_at: string;
  shared_by_label?: string;
}

export type SharedSnapshotPayload = SharedSnapshotNotePayload | SharedSnapshotTaskPayload;

/**
 * Zod schema for snapshot payload (post-decryption validation).
 * Discriminated union on `type`. v must equal SNAPSHOT_PAYLOAD_VERSION.
 */
export const SharedSnapshotPayloadSchema: z.ZodType<SharedSnapshotPayload> = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('note'),
      v: z.literal(SNAPSHOT_PAYLOAD_VERSION),
      title: z.string().max(1000),
      content: z.string().max(500_000),
      metadata: z
        .object({
          is_starred: z.boolean().optional(),
          is_pinned: z.boolean().optional(),
          tags: z.array(z.string()).optional(),
          created_at: z.string().optional(),
          updated_at: z.string().optional(),
          image_mode: z.enum(['always', 'never', 'ask']).optional()
        })
        .passthrough()
        .optional(),
      shared_at: z.string(),
      shared_by_label: z.string().max(SHARE_SENDER_LABEL_MAX_LENGTH).optional()
    }),
    z.object({
      type: z.literal('task'),
      v: z.literal(SNAPSHOT_PAYLOAD_VERSION),
      title: z.string().max(1000),
      description: z.string().max(10_000).optional(),
      metadata: z.object({}).passthrough(),
      subtasks: z
        .array(
          z.object({
            name: z.string().max(1000),
            metadata: z.object({}).passthrough().optional()
          })
        )
        .max(500),
      shared_at: z.string(),
      shared_by_label: z.string().max(SHARE_SENDER_LABEL_MAX_LENGTH).optional()
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
  password: z.string().min(8).max(200).optional()
});
export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>;

/** Response of POST /api/shares — slug used to construct public URL. */
export interface CreateShareResponse {
  id: string;
  slug: string;
  created_at: string;
  expires_at: string | null;
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
  access_count: number;
}

export interface SharePasswordRequiredResponse {
  password_required: true;
}

export type SharePublicResponse = ShareViewResponse | SharePasswordRequiredResponse;

// ─── API: GET /api/shares (list own, auth required) ──────────────────

/**
 * Listing item for the owner. Includes owner_key_wrapped so the client
 * can reconstruct the URL on any device. Excludes payload_encrypted —
 * for content preview the client fetches the public endpoint like any
 * other recipient.
 */
export interface OwnShareListItem {
  id: string;
  slug: string;
  owner_key_wrapped: string;
  has_password: boolean;
  expires_at: string | null;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number;
  revoked_at: string | null;
}

export const OwnShareListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  owner_key_wrapped: z.string(),
  has_password: z.boolean(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  last_accessed_at: z.string().nullable(),
  access_count: z.number().int().nonnegative(),
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
