import { describe, it, expect } from 'vitest';
import {
  EncryptedEntitySchema,
  SyncableSchema,
  SyncableEncryptedEntitySchema
} from '../base';

describe('Base Schemas', () => {
  describe('EncryptedEntitySchema', () => {
    it('should validate a valid encrypted entity', () => {
      const validEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = EncryptedEntitySchema.safeParse(validEntity);
      expect(result.success).toBe(true);
    });

    it('should validate entity with deleted_at', () => {
      const entityWithDeletedAt = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: '2024-01-02T00:00:00.000Z'
      };

      const result = EncryptedEntitySchema.safeParse(entityWithDeletedAt);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const invalidEntity = {
        id: 'invalid-uuid',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = EncryptedEntitySchema.safeParse(invalidEntity);
      expect(result.success).toBe(false);
    });

    it('should reject invalid datetime', () => {
      const invalidEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        created_at: 'invalid-date',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = EncryptedEntitySchema.safeParse(invalidEntity);
      expect(result.success).toBe(false);
    });
  });

  describe('SyncableSchema', () => {
    it('should validate a valid syncable entity', () => {
      const validSyncable = {
        sync_version: 1,
        sync_status: 'synced' as const
      };

      const result = SyncableSchema.safeParse(validSyncable);
      expect(result.success).toBe(true);
    });

    it('should validate all sync statuses', () => {
      const statuses = ['pending', 'synced', 'conflict'] as const;
      
      statuses.forEach(status => {
        const syncable = {
          sync_version: 1,
          sync_status: status
        };
        const result = SyncableSchema.safeParse(syncable);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid sync status', () => {
      const invalidSyncable = {
        sync_version: 1,
        sync_status: 'invalid-status'
      };

      const result = SyncableSchema.safeParse(invalidSyncable);
      expect(result.success).toBe(false);
    });

    it('should reject negative sync version', () => {
      const invalidSyncable = {
        sync_version: -1,
        sync_status: 'synced' as const
      };

      const result = SyncableSchema.safeParse(invalidSyncable);
      expect(result.success).toBe(false);
    });
  });

  describe('SyncableEncryptedEntitySchema', () => {
    it('should validate a complete syncable encrypted entity', () => {
      const validEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        sync_version: 1,
        sync_status: 'synced' as const,
        last_sync_at: '2024-01-01T12:00:00.000Z',
        device_id: 'device-123'
      };

      const result = SyncableEncryptedEntitySchema.safeParse(validEntity);
      expect(result.success).toBe(true);
    });

    it('should validate minimal syncable encrypted entity', () => {
      const minimalEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        sync_version: 0,
        sync_status: 'pending' as const
      };

      const result = SyncableEncryptedEntitySchema.safeParse(minimalEntity);
      expect(result.success).toBe(true);
    });
  });
});
