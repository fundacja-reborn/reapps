import { describe, it, expect } from 'vitest';
import { 
  boolToInt, 
  intToBool, 
  createBooleanTransformer,
  createNestedBooleanTransformer,
  combineTransformers
} from '../transformers/boolean';
import type { BooleanInt } from '@reborn/types';

describe('Boolean Transformers', () => {
  describe('boolToInt', () => {
    it('should convert true to 1', () => {
      expect(boolToInt(true)).toBe(1);
    });

    it('should convert false to 0', () => {
      expect(boolToInt(false)).toBe(0);
    });
  });

  describe('intToBool', () => {
    it('should convert 1 to true', () => {
      expect(intToBool(1 as BooleanInt)).toBe(true);
    });

    it('should convert 0 to false', () => {
      expect(intToBool(0 as BooleanInt)).toBe(false);
    });
  });

  describe('createBooleanTransformer', () => {
    interface TestItem {
      id: string;
      is_active: boolean;
      is_verified: boolean;
      name: string;
      count: number;
    }

    const transformer = createBooleanTransformer<TestItem>(['is_active', 'is_verified']);

    it('should transform boolean fields to BooleanInt for storage', () => {
      const item: TestItem = {
        id: '1',
        is_active: true,
        is_verified: false,
        name: 'Test',
        count: 5
      };

      const stored = transformer.toStorage(item);
      
      expect(stored.is_active).toBe(1);
      expect(stored.is_verified).toBe(0);
      expect(stored.name).toBe('Test');
      expect(stored.count).toBe(5);
    });

    it('should transform BooleanInt fields back to boolean', () => {
      const stored = {
        id: '1',
        is_active: 1 as BooleanInt,
        is_verified: 0 as BooleanInt,
        name: 'Test',
        count: 5
      };

      const item = transformer.fromStorage(stored as any);
      
      expect(item.is_active).toBe(true);
      expect(item.is_verified).toBe(false);
      expect(item.name).toBe('Test');
      expect(item.count).toBe(5);
    });

    it('should handle missing fields gracefully', () => {
      const item = {
        id: '1',
        name: 'Test'
      };

      const stored = transformer.toStorage(item as any);
      expect(stored).toEqual(item);

      const restored = transformer.fromStorage(stored as any);
      expect(restored).toEqual(item);
    });
  });

  describe('createNestedBooleanTransformer', () => {
    interface ParentItem {
      id: string;
      name: string;
      items: Array<{
        id: string;
        is_completed: boolean;
        title: string;
      }>;
    }

    const transformer = createNestedBooleanTransformer<ParentItem, 'items'>('items', ['is_completed']);

    it('should transform nested boolean fields', () => {
      const parent: ParentItem = {
        id: '1',
        name: 'Parent',
        items: [
          { id: 'sub1', is_completed: true, title: 'Item 1' },
          { id: 'sub2', is_completed: false, title: 'Item 2' }
        ]
      };

      const stored = transformer.toStorage(parent);
      
      expect(stored.items[0].is_completed).toBe(1);
      expect(stored.items[1].is_completed).toBe(0);
      expect(stored.items[0].title).toBe('Item 1');
    });

    it('should restore nested boolean fields', () => {
      const stored = {
        id: '1',
        name: 'Parent',
        items: [
          { id: 'sub1', is_completed: 1 as BooleanInt, title: 'Item 1' },
          { id: 'sub2', is_completed: 0 as BooleanInt, title: 'Item 2' }
        ]
      };

      const parent = transformer.fromStorage(stored as any);
      
      expect(parent.items[0].is_completed).toBe(true);
      expect(parent.items[1].is_completed).toBe(false);
    });

    it('should handle missing parent field', () => {
      const parent = {
        id: '1',
        name: 'Parent'
      };

      const stored = transformer.toStorage(parent as any);
      expect(stored).toEqual(parent);
    });
  });

  describe('combineTransformers', () => {
    interface ComplexItem {
      id: string;
      is_active: boolean;
      is_featured: boolean;
      subitems: Array<{
        is_done: boolean;
      }>;
    }

    const mainTransformer = createBooleanTransformer<ComplexItem>(['is_active', 'is_featured']);
    const nestedTransformer = createNestedBooleanTransformer<ComplexItem, 'subitems'>('subitems', ['is_done']);
    const combined = combineTransformers(mainTransformer, nestedTransformer);

    it('should apply multiple transformers in sequence', () => {
      const item: ComplexItem = {
        id: '1',
        is_active: true,
        is_featured: false,
        subitems: [
          { is_done: true },
          { is_done: false }
        ]
      };

      const stored = combined.toStorage(item);
      
      expect(stored.is_active).toBe(1);
      expect(stored.is_featured).toBe(0);
      expect(stored.subitems[0].is_done).toBe(1);
      expect(stored.subitems[1].is_done).toBe(0);
    });

    it('should restore through multiple transformers', () => {
      const stored = {
        id: '1',
        is_active: 1 as BooleanInt,
        is_featured: 0 as BooleanInt,
        subitems: [
          { is_done: 1 as BooleanInt },
          { is_done: 0 as BooleanInt }
        ]
      };

      const item = combined.fromStorage(stored as any);
      
      expect(item.is_active).toBe(true);
      expect(item.is_featured).toBe(false);
      expect(item.subitems[0].is_done).toBe(true);
      expect(item.subitems[1].is_done).toBe(false);
    });
  });
});
