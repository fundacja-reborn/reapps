import { describe, it, expect } from 'vitest';
import {
  TaskDecryptedSchema,
  TaskEncryptedSchema,
  SubtaskSchema,
  SubtaskEncryptedSchema,
  RecurrencePatternSchema
} from '../entities/task';

describe('Task Schemas', () => {
  describe('TaskDecryptedSchema', () => {
    it('should validate a valid decrypted task', () => {
      const validTask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        task_list_id: '123e4567-e89b-12d3-a456-426614174001',
        title: 'Test Task',
        is_completed: false,
        is_starred: false,
        is_template: false,
        position: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = TaskDecryptedSchema.safeParse(validTask);
      expect(result.success).toBe(true);
    });

    it('should validate task with all optional fields', () => {
      const completeTask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        task_list_id: '123e4567-e89b-12d3-a456-426614174001',
        title: 'Complete Task',
        description: 'Task description',
        due_date: '2024-12-31T23:59:59.000Z',
        has_time: true,
        is_completed: true,
        is_starred: true,
        is_recurring: true,
        is_template: false,
        recurrence_rule: 'FREQ=DAILY;INTERVAL=1',
        completed_at: '2024-01-02T00:00:00.000Z',
        next_occurrence_date: '2024-01-03T00:00:00.000Z',
        completed_occurrences_count: 5,
        subtasks: [
          {
            id: '123e4567-e89b-12d3-a456-426614174002',
            task_id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Subtask 1',
            is_completed: false,
            position: 0,
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z'
          }
        ],
        position: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: '2024-01-01T12:00:00.000Z'
      };

      const result = TaskDecryptedSchema.safeParse(completeTask);
      expect(result.success).toBe(true);
    });

    it('should reject task with empty title', () => {
      const invalidTask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        task_list_id: '123e4567-e89b-12d3-a456-426614174001',
        title: '',
        is_completed: false,
        is_starred: false,
        position: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = TaskDecryptedSchema.safeParse(invalidTask);
      expect(result.success).toBe(false);
    });

    it('should reject task with negative position', () => {
      const invalidTask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        task_list_id: '123e4567-e89b-12d3-a456-426614174001',
        title: 'Test Task',
        is_completed: false,
        is_starred: false,
        position: -1,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = TaskDecryptedSchema.safeParse(invalidTask);
      expect(result.success).toBe(false);
    });
  });

  describe('TaskEncryptedSchema', () => {
    it('should validate a valid encrypted task', () => {
      const validTask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        task_list_id: '123e4567-e89b-12d3-a456-426614174002',
        title_encrypted: 'encrypted_title_data',
        metadata_encrypted: 'encrypted_metadata',
        is_template: 0,
        position: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        sync_version: 1,
        sync_status: 'synced' as const
      };

      const result = TaskEncryptedSchema.safeParse(validTask);
      expect(result.success).toBe(true);
    });

    it('should validate encrypted task with optional fields', () => {
      const completeTask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        task_list_id: '123e4567-e89b-12d3-a456-426614174002',
        title_encrypted: 'encrypted_title_data',
        description_encrypted: 'encrypted_description_data',
        metadata_encrypted: 'encrypted_metadata_bundle',
        recurrence_rule_encrypted: 'encrypted_rule',
        is_template: 0,
        position: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        sync_version: 2,
        sync_status: 'synced' as const,
        last_sync_at: '2024-01-01T12:00:00.000Z',
        device_id: 'device-123'
      };

      const result = TaskEncryptedSchema.safeParse(completeTask);
      expect(result.success).toBe(true);
    });

    it('should reject encrypted task without metadata_encrypted', () => {
      const invalidTask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
        task_list_id: '123e4567-e89b-12d3-a456-426614174002',
        title_encrypted: 'encrypted_title_data',
        is_template: 0,
        position: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        sync_version: 1,
        sync_status: 'synced' as const
      };

      const result = TaskEncryptedSchema.safeParse(invalidTask);
      expect(result.success).toBe(false);
    });
  });

  describe('SubtaskSchema', () => {
    it('should validate a valid subtask', () => {
      const validSubtask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        task_id: '123e4567-e89b-12d3-a456-426614174001',
        title: 'Subtask Title',
        is_completed: false,
        position: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = SubtaskSchema.safeParse(validSubtask);
      expect(result.success).toBe(true);
    });

    it('should reject subtask with empty title', () => {
      const invalidSubtask = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        task_id: '123e4567-e89b-12d3-a456-426614174001',
        title: '',
        is_completed: false,
        position: 0,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      };

      const result = SubtaskSchema.safeParse(invalidSubtask);
      expect(result.success).toBe(false);
    });
  });

  describe('RecurrencePatternSchema', () => {
    it('should validate daily recurrence', () => {
      const dailyRecurrence = {
        frequency: 'daily' as const,
        interval: 1
      };

      const result = RecurrencePatternSchema.safeParse(dailyRecurrence);
      expect(result.success).toBe(true);
    });

    it('should validate weekly recurrence with days', () => {
      const weeklyRecurrence = {
        frequency: 'weekly' as const,
        interval: 2,
        days_of_week: [1, 3, 5]
      };

      const result = RecurrencePatternSchema.safeParse(weeklyRecurrence);
      expect(result.success).toBe(true);
    });

    it('should validate monthly recurrence with day of month', () => {
      const monthlyRecurrence = {
        frequency: 'monthly' as const,
        interval: 1,
        day_of_month: 15
      };

      const result = RecurrencePatternSchema.safeParse(monthlyRecurrence);
      expect(result.success).toBe(true);
    });

    it('should validate yearly recurrence with end date', () => {
      const yearlyRecurrence = {
        frequency: 'yearly' as const,
        interval: 1,
        end_date: '2025-12-31T23:59:59.000Z'
      };

      const result = RecurrencePatternSchema.safeParse(yearlyRecurrence);
      expect(result.success).toBe(true);
    });

    it('should reject invalid frequency', () => {
      const invalidRecurrence = {
        frequency: 'invalid' as any,
        interval: 1
      };

      const result = RecurrencePatternSchema.safeParse(invalidRecurrence);
      expect(result.success).toBe(false);
    });

    it('should reject negative interval', () => {
      const invalidRecurrence = {
        frequency: 'daily' as const,
        interval: -1
      };

      const result = RecurrencePatternSchema.safeParse(invalidRecurrence);
      expect(result.success).toBe(false);
    });

    it('should reject invalid day of week', () => {
      const invalidRecurrence = {
        frequency: 'weekly' as const,
        interval: 1,
        days_of_week: [7]
      };

      const result = RecurrencePatternSchema.safeParse(invalidRecurrence);
      expect(result.success).toBe(false);
    });

    it('should reject invalid day of month', () => {
      const invalidRecurrence = {
        frequency: 'monthly' as const,
        interval: 1,
        day_of_month: 32
      };

      const result = RecurrencePatternSchema.safeParse(invalidRecurrence);
      expect(result.success).toBe(false);
    });
  });
});
