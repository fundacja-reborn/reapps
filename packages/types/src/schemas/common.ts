import { z } from 'zod';

/**
 * Schema for BooleanInt - boolean values stored as 0 or 1 for IndexedDB indexing
 */
export const BooleanIntSchema = z.union([z.literal(0), z.literal(1)]);

/**
 * Transform boolean to BooleanInt
 */
export const booleanToBooleanIntSchema = z.boolean().transform(val => val ? 1 : 0 as const);

/**
 * Transform BooleanInt to boolean
 */
export const booleanIntToBooleanSchema = BooleanIntSchema.transform(val => val === 1);
