import { describe, it, expect } from 'vitest';
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  SyncRequestSchema,
  PaginationParamsSchema
} from '../api/requests';

describe('API Request Schemas', () => {
  describe('LoginRequestSchema', () => {
    it('should validate a valid login request', () => {
      const validRequest = {
        username: 'testuser',
        password: 'password123'
      };

      const result = LoginRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should validate login request with device name', () => {
      const requestWithDevice = {
        username: 'testuser',
        password: 'password123',
        device_name: 'iPhone 15'
      };

      const result = LoginRequestSchema.safeParse(requestWithDevice);
      expect(result.success).toBe(true);
    });

    it('should reject short username', () => {
      const invalidRequest = {
        username: 'ab',
        password: 'password123'
      };

      const result = LoginRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject short password', () => {
      const invalidRequest = {
        username: 'testuser',
        password: 'pass'
      };

      const result = LoginRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject long username', () => {
      const invalidRequest = {
        username: 'a'.repeat(51),
        password: 'password123'
      };

      const result = LoginRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('RegisterRequestSchema', () => {
    it('should validate a valid register request', () => {
      const validRequest = {
        username: 'newuser',
        password: 'password123'
      };

      const result = RegisterRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should validate register request with device name', () => {
      const requestWithDevice = {
        username: 'newuser',
        password: 'password123',
        device_name: 'iPhone 15'
      };

      const result = RegisterRequestSchema.safeParse(requestWithDevice);
      expect(result.success).toBe(true);
    });
  });

  describe('SyncRequestSchema', () => {
    it('should validate a valid sync request', () => {
      const validRequest = {
        device_id: 'device-123',
        changes: {}
      };

      const result = SyncRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should validate sync request with last sync', () => {
      const requestWithLastSync = {
        last_sync_at: '2024-01-01T00:00:00.000Z',
        device_id: 'device-123',
        changes: {}
      };

      const result = SyncRequestSchema.safeParse(requestWithLastSync);
      expect(result.success).toBe(true);
    });

    it('should validate sync request with changes', () => {
      const requestWithChanges = {
        device_id: 'device-123',
        changes: {
          tasks: [{ id: '123', title: 'Task' }],
          lists: [{ id: '456', name: 'List' }],
          notes: [{ id: '789', content: 'Note' }],
          folders: [{ id: '012', name: 'Folder' }]
        }
      };

      const result = SyncRequestSchema.safeParse(requestWithChanges);
      expect(result.success).toBe(true);
    });

    it('should reject sync request without device_id', () => {
      const invalidRequest = {
        changes: {}
      };

      const result = SyncRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('PaginationParamsSchema', () => {
    it('should validate empty pagination params', () => {
      const emptyParams = {};

      const result = PaginationParamsSchema.safeParse(emptyParams);
      expect(result.success).toBe(true);
    });

    it('should validate complete pagination params', () => {
      const completeParams = {
        page: 2,
        limit: 50,
        sort: 'created_at',
        order: 'desc' as const
      };

      const result = PaginationParamsSchema.safeParse(completeParams);
      expect(result.success).toBe(true);
    });

    it('should reject negative page', () => {
      const invalidParams = {
        page: -1
      };

      const result = PaginationParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should reject limit over 100', () => {
      const invalidParams = {
        limit: 101
      };

      const result = PaginationParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should reject invalid order', () => {
      const invalidParams = {
        order: 'invalid' as any
      };

      const result = PaginationParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });
  });
});
