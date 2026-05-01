import { describe, it, expect } from 'vitest';
import { NoteDecryptedSchema, NoteEncryptedSchema } from '../entities/note';
import { FolderDecryptedSchema, FolderEncryptedSchema } from '../entities/folder';
import { TagDecryptedSchema } from '../entities/tag';

describe('Note Schemas', () => {
  describe('NoteDecryptedSchema', () => {
    it('should validate a valid decrypted note', () => {
      const validNote = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Note',
        content: 'This is test content',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = NoteDecryptedSchema.safeParse(validNote);
      expect(result.success).toBe(true);
    });

    it('should validate note with folder and tags', () => {
      const noteWithMetadata = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        folder_id: '123e4567-e89b-12d3-a456-426614174001',
        title: 'Test Note',
        content: 'This is test content',
        tags: ['work', 'important'],
        is_pinned: true,
        is_archived: false,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = NoteDecryptedSchema.safeParse(noteWithMetadata);
      expect(result.success).toBe(true);
    });

    it('should reject note with empty title', () => {
      const invalidNote = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: '',
        content: 'Content',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = NoteDecryptedSchema.safeParse(invalidNote);
      expect(result.success).toBe(false);
    });
  });

  describe('FolderDecryptedSchema', () => {
    it('should validate a valid folder', () => {
      const validFolder = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Work Notes',
        order_index: 0,
        is_archived: false,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = FolderDecryptedSchema.safeParse(validFolder);
      expect(result.success).toBe(true);
    });

    it('should validate nested folder with color', () => {
      const nestedFolder = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        parent_id: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Projects',
        color: '#FF5733',
        icon: '📁',
        order_index: 1,
        is_archived: false,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = FolderDecryptedSchema.safeParse(nestedFolder);
      expect(result.success).toBe(true);
    });

    it('should reject folder with invalid color format', () => {
      const invalidFolder = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Work Notes',
        color: 'red',
        order_index: 0,
        is_archived: false,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = FolderDecryptedSchema.safeParse(invalidFolder);
      expect(result.success).toBe(false);
    });
  });

  describe('null tolerance for FK fields (regression)', () => {
    // Server (Prisma) returns `null` for absent foreign keys; client code uses
    // `undefined`. Both must be accepted so JSON backups round-trip cleanly
    // regardless of which producer wrote the file. See guideline 44.
    const baseEncryptedNote = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
      title_encrypted: 'iv:cipher',
      content_encrypted: 'iv:cipher',
      sync_version: 0,
      sync_status: 'synced' as const,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z'
    };

    const baseEncryptedFolder = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
      name_encrypted: 'iv:cipher',
      order_index: 0,
      is_archived: false,
      sync_version: 0,
      sync_status: 'synced' as const,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z'
    };

    it('accepts NoteEncryptedSchema with folder_id=null (root note from server)', () => {
      const result = NoteEncryptedSchema.safeParse({ ...baseEncryptedNote, folder_id: null });
      expect(result.success).toBe(true);
    });

    it('accepts NoteEncryptedSchema with folder_id absent (client-created)', () => {
      const result = NoteEncryptedSchema.safeParse(baseEncryptedNote);
      expect(result.success).toBe(true);
    });

    it('accepts NoteDecryptedSchema with folder_id=null', () => {
      const result = NoteDecryptedSchema.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test',
        content: 'Body',
        folder_id: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      });
      expect(result.success).toBe(true);
    });

    it('accepts FolderEncryptedSchema with parent_id=null (root folder)', () => {
      const result = FolderEncryptedSchema.safeParse({ ...baseEncryptedFolder, parent_id: null });
      expect(result.success).toBe(true);
    });

    it('accepts FolderDecryptedSchema with parent_id=null', () => {
      const result = FolderDecryptedSchema.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        parent_id: null,
        name: 'Inbox',
        order_index: 0,
        is_archived: false,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      });
      expect(result.success).toBe(true);
    });

    it('still rejects malformed UUID in folder_id', () => {
      const result = NoteEncryptedSchema.safeParse({
        ...baseEncryptedNote,
        folder_id: 'not-a-uuid'
      });
      expect(result.success).toBe(false);
    });

    it('still rejects malformed UUID in parent_id', () => {
      const result = FolderEncryptedSchema.safeParse({
        ...baseEncryptedFolder,
        parent_id: 'not-a-uuid'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('TagDecryptedSchema', () => {
    it('should validate a valid tag', () => {
      const validTag = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'important',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = TagDecryptedSchema.safeParse(validTag);
      expect(result.success).toBe(true);
    });

    it('should validate tag with color', () => {
      const tagWithColor = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'urgent',
        color: '#FF0000',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = TagDecryptedSchema.safeParse(tagWithColor);
      expect(result.success).toBe(true);
    });
  });
});
