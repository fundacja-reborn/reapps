import type { BooleanInt } from '@reborn/types';

/**
 * Convert boolean value to BooleanInt (0 or 1)
 */
export function boolToInt(value: boolean): BooleanInt {
  return value ? 1 : 0;
}

/**
 * Convert BooleanInt (0 or 1) to boolean
 */
export function intToBool(value: BooleanInt): boolean {
  return value === 1;
}

/**
 * Create a transformer for objects with boolean fields that need to be stored as BooleanInt
 * 
 * @param fields - Array of field names that should be transformed
 * @returns Object with toStorage and fromStorage transform functions
 */
export function createBooleanTransformer<T extends Record<string, any>>(
  fields: (keyof T)[]
) {
  return {
    /**
     * Transform boolean fields to BooleanInt for storage
     */
    toStorage: (item: T): T => {
      const result = { ...item };
      
      fields.forEach(field => {
        if (field in result && typeof result[field] === 'boolean') {
          (result as any)[field] = boolToInt(result[field] as boolean);
        }
      });
      
      return result;
    },
    
    /**
     * Transform BooleanInt fields back to boolean for usage
     */
    fromStorage: (item: T): T => {
      const result = { ...item };
      
      fields.forEach(field => {
        if (field in result && (result[field] === 0 || result[field] === 1)) {
          (result as any)[field] = intToBool(result[field] as BooleanInt);
        }
      });
      
      return result;
    }
  };
}

/**
 * Create a transformer for nested objects (like subtasks) with boolean fields
 * 
 * @param parentField - Name of the parent field containing the array
 * @param fields - Array of field names in nested objects that should be transformed
 * @returns Object with toStorage and fromStorage transform functions
 */
export function createNestedBooleanTransformer<
  T extends Record<string, any>,
  K extends keyof T
>(
  parentField: K,
  fields: string[]
) {
  return {
    /**
     * Transform nested boolean fields to BooleanInt for storage
     */
    toStorage: (item: T): T => {
      const result = { ...item };
      
      if (parentField in result && Array.isArray(result[parentField])) {
        const transformed = (result[parentField] as any[]).map(nested => {
          const transformedNested = { ...nested };
          
          fields.forEach(field => {
            if (field in transformedNested && typeof transformedNested[field] === 'boolean') {
              transformedNested[field] = boolToInt(transformedNested[field] as boolean);
            }
          });
          
          return transformedNested;
        });
        
        (result as any)[parentField] = transformed;
      }
      
      return result;
    },
    
    /**
     * Transform nested BooleanInt fields back to boolean for usage
     */
    fromStorage: (item: T): T => {
      const result = { ...item };
      
      if (parentField in result && Array.isArray(result[parentField])) {
        const transformed = (result[parentField] as any[]).map(nested => {
          const transformedNested = { ...nested };
          
          fields.forEach(field => {
            if (field in transformedNested && (transformedNested[field] === 0 || transformedNested[field] === 1)) {
              transformedNested[field] = intToBool(transformedNested[field] as BooleanInt);
            }
          });
          
          return transformedNested;
        });
        
        (result as any)[parentField] = transformed;
      }
      
      return result;
    }
  };
}

/**
 * Combine multiple transformers into a single transformer
 * 
 * @param transformers - Array of transformers to combine
 * @returns Combined transformer
 */
export function combineTransformers<T>(...transformers: Array<{
  toStorage: (item: T) => T;
  fromStorage: (item: T) => T;
}>) {
  return {
    toStorage: (item: T): T => {
      return transformers.reduce((result, transformer) => {
        return transformer.toStorage(result);
      }, item);
    },
    
    fromStorage: (item: T): T => {
      return transformers.reduce((result, transformer) => {
        return transformer.fromStorage(result);
      }, item);
    }
  };
}
