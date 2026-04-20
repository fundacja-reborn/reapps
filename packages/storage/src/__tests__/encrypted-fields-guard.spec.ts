import { describe, it, expect, vi } from 'vitest';

// Mock @reborn/crypto validation functions
vi.mock('@reborn/crypto', () => ({
  validateEncryptedPayload: vi.fn((data: Record<string, unknown>) => {
    if (typeof data !== 'object' || data === null) return;
    for (const key of Object.keys(data)) {
      if (!key.endsWith('_encrypted')) continue;
      const value = data[key];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string') {
        throw new Error(
          `Encryption guard: field "${key}" has type "${typeof value}" instead of string.`
        );
      }
      // Check for iv:ciphertext format (simplified)
      const parts = value.split(':');
      if (parts.length !== 2 || parts[0].length < 16 || parts[1].length < 4) {
        throw new Error(`Encryption guard: invalid encrypted format (field: ${key}).`);
      }
    }
  })
}));

import { validateEncryptedPayload } from '@reborn/crypto';

const VALID_IV = 'dGVzdGl2MTIzNDU2'; // 16 chars base64
const VALID_CIPHERTEXT = 'Y2lwaGVydGV4dGRhdGE=';
const VALID_ENCRYPTED = `${VALID_IV}:${VALID_CIPHERTEXT}`;

describe('Pre-save encryption guard (IndexedDBStore)', () => {
  describe('validateEncryptedPayload integration', () => {
    it('accepts valid encrypted fields', () => {
      const data = {
        id: 'note-1',
        title_encrypted: VALID_ENCRYPTED,
        content_encrypted: VALID_ENCRYPTED,
        is_pinned: false
      };
      expect(() => validateEncryptedPayload(data)).not.toThrow();
    });

    it('throws for plaintext in encrypted field', () => {
      const data = {
        id: 'note-1',
        title_encrypted: 'Buy groceries'
      };
      expect(() => validateEncryptedPayload(data)).toThrow('Encryption guard');
    });

    it('skips null/undefined encrypted fields', () => {
      const data = {
        id: 'note-1',
        title_encrypted: VALID_ENCRYPTED,
        description_encrypted: null,
        metadata_encrypted: undefined
      };
      expect(() => validateEncryptedPayload(data)).not.toThrow();
    });

    it('throws for non-string encrypted field value', () => {
      const data = {
        id: 'note-1',
        title_encrypted: 42
      };
      expect(() => validateEncryptedPayload(data as any)).toThrow('Encryption guard');
    });

    it('passes for objects without encrypted fields', () => {
      const data = {
        id: 'sync-1',
        entity_type: 'note',
        operation: 'create',
        timestamp: '2026-01-01T00:00:00Z'
      };
      expect(() => validateEncryptedPayload(data)).not.toThrow();
    });

    it('validates task encrypted payload', () => {
      const data = {
        id: 'task-1',
        title_encrypted: VALID_ENCRYPTED,
        description_encrypted: VALID_ENCRYPTED,
        list_id: 'list-1',
        is_completed: 0
      };
      expect(() => validateEncryptedPayload(data)).not.toThrow();
    });

    it('validates folder encrypted payload', () => {
      const data = {
        id: 'folder-1',
        name_encrypted: VALID_ENCRYPTED,
        parent_id: null,
        order_index: 0
      };
      expect(() => validateEncryptedPayload(data)).not.toThrow();
    });

    it('validates tag encrypted payload with optional color', () => {
      const data = {
        id: 'tag-1',
        name_encrypted: VALID_ENCRYPTED,
        color_encrypted: null
      };
      expect(() => validateEncryptedPayload(data)).not.toThrow();
    });
  });
});
