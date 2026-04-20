import { describe, it, expect } from 'vitest';
import { NoteDecryptedSchema, NoteEncryptedSchema } from '../entities/note';
import { FolderDecryptedSchema } from '../entities/folder';
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
