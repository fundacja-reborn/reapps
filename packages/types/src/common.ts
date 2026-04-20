/**
 * Common types used across the application
 */

import { z } from 'zod';

/**
 * Type for boolean values stored as integers in IndexedDB
 * This allows for efficient indexing which is not possible with boolean values
 */
export type BooleanInt = 0 | 1;

/**
 * Zod schema for BooleanInt validation
 */
export const BooleanIntSchema = z.union([z.literal(0), z.literal(1)]);

/**
 * Helper type to convert boolean fields to BooleanInt
 */
export type BooleanFieldsToInt<T, K extends keyof T> = 
  Omit<T, K> & {
    [P in K]: T[P] extends boolean ? BooleanInt : T[P];
  };

/**
 * Helper type to convert BooleanInt fields back to boolean
 */
export type IntFieldsToBoolean<T, K extends keyof T> = 
  Omit<T, K> & {
    [P in K]: T[P] extends BooleanInt ? boolean : T[P];
  };
