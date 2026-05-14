import { describe, it, expect } from 'vitest';
import {
  CreateShareRequestSchema,
  SharedSnapshotPayloadSchema,
  SlugSchema,
  SHARE_SLUG_LENGTH,
  SNAPSHOT_PAYLOAD_VERSION
} from '../../share';

const validBlob = 'YWFhYWFhYWFhYWFhYWFhYQ==:dGVzdA==';

describe('CreateShareRequestSchema', () => {
  it('accepts a minimal valid body', () => {
    const result = CreateShareRequestSchema.safeParse({
      payload_encrypted: validBlob,
      owner_key_wrapped: validBlob
    });
    expect(result.success).toBe(true);
  });

  it('rejects payload_encrypted that does not match iv:ciphertext base64', () => {
    const result = CreateShareRequestSchema.safeParse({
      payload_encrypted: 'plaintext-leak',
      owner_key_wrapped: validBlob
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing owner_key_wrapped', () => {
    const result = CreateShareRequestSchema.safeParse({ payload_encrypted: validBlob });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive expiry', () => {
    const result = CreateShareRequestSchema.safeParse({
      payload_encrypted: validBlob,
      owner_key_wrapped: validBlob,
      expires_in_seconds: 0
    });
    expect(result.success).toBe(false);
  });

  it('accepts null expires_in_seconds (never expires)', () => {
    const result = CreateShareRequestSchema.safeParse({
      payload_encrypted: validBlob,
      owner_key_wrapped: validBlob,
      expires_in_seconds: null
    });
    expect(result.success).toBe(true);
  });

  it('rejects a password shorter than 8 chars', () => {
    const result = CreateShareRequestSchema.safeParse({
      payload_encrypted: validBlob,
      owner_key_wrapped: validBlob,
      password: 'short'
    });
    expect(result.success).toBe(false);
  });
});

describe('SharedSnapshotPayloadSchema', () => {
  it('accepts a note payload', () => {
    const result = SharedSnapshotPayloadSchema.safeParse({
      type: 'note',
      v: SNAPSHOT_PAYLOAD_VERSION,
      title: 'Hello',
      content: 'World',
      shared_at: '2026-05-14T10:00:00.000Z'
    });
    expect(result.success).toBe(true);
  });

  it('accepts a task payload with subtasks', () => {
    const result = SharedSnapshotPayloadSchema.safeParse({
      type: 'task',
      v: SNAPSHOT_PAYLOAD_VERSION,
      title: 'Prep',
      metadata: { is_completed: false, is_starred: false },
      subtasks: [
        { name: 'first', metadata: { is_completed: false } },
        { name: 'second' }
      ],
      shared_at: '2026-05-14T10:00:00.000Z'
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const result = SharedSnapshotPayloadSchema.safeParse({
      type: 'folder',
      v: SNAPSHOT_PAYLOAD_VERSION,
      title: 'x',
      shared_at: '2026-05-14T10:00:00.000Z'
    });
    expect(result.success).toBe(false);
  });

  it('rejects mismatched payload version', () => {
    const result = SharedSnapshotPayloadSchema.safeParse({
      type: 'note',
      v: 99,
      title: 'x',
      content: 'y',
      shared_at: '2026-05-14T10:00:00.000Z'
    });
    expect(result.success).toBe(false);
  });
});

describe('SlugSchema', () => {
  it('accepts a 16-char base64url slug', () => {
    expect(SlugSchema.safeParse('AbCd1234EfGh5678').success).toBe(true);
    expect(SlugSchema.safeParse('___---___---____').success).toBe(true);
    expect(SHARE_SLUG_LENGTH).toBe(16);
  });

  it('rejects wrong length, padding, or unsafe characters', () => {
    expect(SlugSchema.safeParse('short').success).toBe(false);
    expect(SlugSchema.safeParse('AbCd1234EfGh567=').success).toBe(false);
    expect(SlugSchema.safeParse('AbCd 1234EfGh567').success).toBe(false);
  });
});
