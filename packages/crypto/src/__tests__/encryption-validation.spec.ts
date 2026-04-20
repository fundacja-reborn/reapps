import { describe, it, expect } from 'vitest';
import {
  isValidEncryptedFormat,
  assertEncrypted,
  validateEncryptedPayload,
  detectPlaintextLeaks,
  KNOWN_SENSITIVE_FIELDS
} from '../encryption-validation';

// A realistic encrypted value: 16-char base64 IV + ":" + base64 ciphertext
const VALID_IV = 'dGVzdGl2MTIzNDU2'; // 16 chars base64
const VALID_CIPHERTEXT = 'Y2lwaGVydGV4dGRhdGE='; // valid base64
const VALID_ENCRYPTED = `${VALID_IV}:${VALID_CIPHERTEXT}`;

describe('isValidEncryptedFormat', () => {
  it('returns true for valid iv:ciphertext format', () => {
    expect(isValidEncryptedFormat(VALID_ENCRYPTED)).toBe(true);
  });

  it('returns true for typical AES-GCM output (long base64)', () => {
    // 12-byte IV = 16 base64 chars, typical ciphertext ~40+ chars
    const iv = 'AAAAAAAAAAAAAAAA'; // 16 chars
    const ct = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 40 chars
    expect(isValidEncryptedFormat(`${iv}:${ct}`)).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidEncryptedFormat('')).toBe(false);
  });

  it('returns false for plaintext without separator', () => {
    expect(isValidEncryptedFormat('hello world')).toBe(false);
  });

  it('returns false for plaintext with spaces', () => {
    expect(isValidEncryptedFormat('My Task Title')).toBe(false);
  });

  it('returns false for value with multiple colons', () => {
    expect(isValidEncryptedFormat('aaa:bbb:ccc')).toBe(false);
  });

  it('returns false when IV part is too short', () => {
    expect(isValidEncryptedFormat('abc:' + VALID_CIPHERTEXT)).toBe(false);
  });

  it('returns false when ciphertext part is too short', () => {
    expect(isValidEncryptedFormat(VALID_IV + ':ab')).toBe(false);
  });

  it('returns false for non-base64 IV', () => {
    expect(isValidEncryptedFormat('!!!invalid!!!!!!:' + VALID_CIPHERTEXT)).toBe(false);
  });

  it('returns false for non-base64 ciphertext', () => {
    expect(isValidEncryptedFormat(VALID_IV + ':not valid base64!')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(isValidEncryptedFormat(null as any)).toBe(false);
    expect(isValidEncryptedFormat(undefined as any)).toBe(false);
    expect(isValidEncryptedFormat(123 as any)).toBe(false);
  });

  it('accepts base64 with padding (=)', () => {
    const paddedIv = 'dGVzdGl2MTIzNA=='; // 16 chars with padding
    const paddedCt = 'Y2lwaGVydGV4dA==';
    expect(isValidEncryptedFormat(`${paddedIv}:${paddedCt}`)).toBe(true);
  });
});

describe('assertEncrypted', () => {
  it('does not throw for valid encrypted format', () => {
    expect(() => assertEncrypted(VALID_ENCRYPTED)).not.toThrow();
  });

  it('throws for plaintext', () => {
    expect(() => assertEncrypted('My Task Title')).toThrow('Encryption guard');
  });

  it('throws with field name in message', () => {
    expect(() => assertEncrypted('plaintext', 'title_encrypted')).toThrow('title_encrypted');
  });

  it('throws for empty string', () => {
    expect(() => assertEncrypted('')).toThrow('Encryption guard');
  });
});

describe('validateEncryptedPayload', () => {
  it('passes for object with valid encrypted fields', () => {
    const data = {
      id: 'abc-123',
      title_encrypted: VALID_ENCRYPTED,
      content_encrypted: VALID_ENCRYPTED,
      is_pinned: false
    };
    expect(() => validateEncryptedPayload(data)).not.toThrow();
  });

  it('skips null encrypted fields (optional)', () => {
    const data = {
      id: 'abc-123',
      title_encrypted: VALID_ENCRYPTED,
      description_encrypted: null
    };
    expect(() => validateEncryptedPayload(data)).not.toThrow();
  });

  it('skips undefined encrypted fields (optional)', () => {
    const data = {
      id: 'abc-123',
      name_encrypted: VALID_ENCRYPTED,
      color_encrypted: undefined
    };
    expect(() => validateEncryptedPayload(data)).not.toThrow();
  });

  it('passes for object with no encrypted fields', () => {
    const data = { id: 'abc-123', name: 'Test', count: 42 };
    expect(() => validateEncryptedPayload(data)).not.toThrow();
  });

  it('throws when encrypted field contains plaintext', () => {
    const data = {
      id: 'abc-123',
      title_encrypted: 'Buy groceries'
    };
    expect(() => validateEncryptedPayload(data)).toThrow('title_encrypted');
  });

  it('throws when encrypted field has non-string type', () => {
    const data = {
      id: 'abc-123',
      title_encrypted: 42
    };
    expect(() => validateEncryptedPayload(data as any)).toThrow('title_encrypted');
  });

  it('handles null/undefined input gracefully', () => {
    expect(() => validateEncryptedPayload(null as any)).not.toThrow();
    expect(() => validateEncryptedPayload(undefined as any)).not.toThrow();
  });

  it('detects multiple invalid fields (throws on first)', () => {
    const data = {
      title_encrypted: 'plaintext',
      content_encrypted: 'also plaintext'
    };
    expect(() => validateEncryptedPayload(data)).toThrow('Encryption guard');
  });

  it('validates all encrypted fields in a realistic note payload', () => {
    const validPayload = {
      id: 'note-1',
      title_encrypted: VALID_ENCRYPTED,
      content_encrypted: VALID_ENCRYPTED,
      folder_id: null,
      is_pinned: false,
      is_starred: false,
      created_at: '2026-01-01T00:00:00Z'
    };
    expect(() => validateEncryptedPayload(validPayload)).not.toThrow();
  });

  it('validates all encrypted fields in a realistic folder payload', () => {
    const validPayload = {
      id: 'folder-1',
      name_encrypted: VALID_ENCRYPTED,
      parent_id: null,
      order_index: 0
    };
    expect(() => validateEncryptedPayload(validPayload)).not.toThrow();
  });

  it('validates all encrypted fields in a realistic tag payload', () => {
    const validPayload = {
      id: 'tag-1',
      name_encrypted: VALID_ENCRYPTED,
      color_encrypted: VALID_ENCRYPTED
    };
    expect(() => validateEncryptedPayload(validPayload)).not.toThrow();
  });

  it('throws when plaintext sibling appears alongside encrypted field', () => {
    const data = {
      id: 'note-1',
      title: 'My Note',
      title_encrypted: VALID_ENCRYPTED,
      content_encrypted: VALID_ENCRYPTED
    };
    expect(() => validateEncryptedPayload(data)).toThrow(/plaintext field "title"/);
  });

  it('throws when known-sensitive plaintext field leaks on entity payload', () => {
    const data = {
      id: 'note-1',
      title_encrypted: VALID_ENCRYPTED,
      content_encrypted: VALID_ENCRYPTED,
      description: 'leaked description'
    };
    expect(() => validateEncryptedPayload(data)).toThrow(/known-sensitive field "description"/);
  });

  it('does NOT trip leak detection on payloads without any encrypted field', () => {
    // Settings / sync-state / auth payloads must continue to pass through.
    const data = { id: 'settings-1', name: 'theme', metadata: { foo: 'bar' } };
    expect(() => validateEncryptedPayload(data)).not.toThrow();
  });

  it('tolerates null sibling alongside encrypted field', () => {
    const data = {
      id: 'note-1',
      title: null,
      title_encrypted: VALID_ENCRYPTED
    };
    expect(() => validateEncryptedPayload(data)).not.toThrow();
  });
});

describe('detectPlaintextLeaks', () => {
  it('exposes a stable list of known sensitive field names', () => {
    expect(KNOWN_SENSITIVE_FIELDS).toEqual([
      'title',
      'name',
      'description',
      'content',
      'color',
      'metadata'
    ]);
  });

  it('throws on plain title alongside title_encrypted', () => {
    expect(() =>
      detectPlaintextLeaks({
        title: 'leak',
        title_encrypted: VALID_ENCRYPTED
      })
    ).toThrow(/plaintext field "title"/);
  });

  it('throws on plain name even without sibling', () => {
    expect(() => detectPlaintextLeaks({ id: 'x', name: 'leak' })).toThrow(
      /known-sensitive field "name"/
    );
  });

  it('throws on plain content', () => {
    expect(() => detectPlaintextLeaks({ id: 'x', content: 'leaked body' })).toThrow(
      /known-sensitive field "content"/
    );
  });

  it('throws on plain metadata object', () => {
    expect(() =>
      detectPlaintextLeaks({ id: 'x', metadata: { is_completed: true } })
    ).toThrow(/known-sensitive field "metadata"/);
  });

  it('does not throw when only encrypted fields present', () => {
    expect(() =>
      detectPlaintextLeaks({
        id: 'x',
        title_encrypted: VALID_ENCRYPTED,
        content_encrypted: VALID_ENCRYPTED
      })
    ).not.toThrow();
  });

  it('does not throw when sensitive fields are explicitly null', () => {
    expect(() =>
      detectPlaintextLeaks({
        id: 'x',
        title: null,
        name: undefined,
        description: null
      })
    ).not.toThrow();
  });
});
