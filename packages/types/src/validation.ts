import type { z } from 'zod';

export type ValidationSuccess<T> = { success: true; data: T };
export type ValidationError = {
  success: false;
  error: string;
  details: z.ZodIssue[];
};
export type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

/**
 * Validate request body against a Zod schema.
 * Returns typed data on success, or structured error on failure.
 */
export function validateBody<T>(schema: z.ZodType<T>, body: unknown): ValidationResult<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      success: false,
      error: 'Invalid request data',
      details: result.error.issues
    };
  }
  return { success: true, data: result.data };
}
