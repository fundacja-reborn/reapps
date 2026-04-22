export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecial: true
} as const;

export type PasswordValidationResult = {
  isValid: boolean;
  errors: string[];
};

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  // Check length
  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push('password.errors.min_length');
  }

  // Check uppercase letters
  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('password.errors.require_uppercase');
  }

  // Check lowercase letters
  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('password.errors.require_lowercase');
  }

  // Check numbers
  if (PASSWORD_REQUIREMENTS.requireNumbers && !/\d/.test(password)) {
    errors.push('password.errors.require_number');
  }

  // Check special characters
  if (PASSWORD_REQUIREMENTS.requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('password.errors.require_special');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function getPasswordRequirementsMessage(): string {
  return 'password.requirements';
}

/**
 * Validates email format
 */
export function validateEmail(email: string): boolean {
  // RFC 5321 caps total length at 254; bound first to avoid ReDoS on pathological input.
  if (email.length > 254) return false;
  // TLD segment excludes '.' so the regex has a single deterministic split point (last dot).
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;
  return emailRegex.test(email);
}

/**
 * Validates username format
 */
export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  if (!username || username.trim().length === 0) {
    return { isValid: false, error: 'username.errors.required' };
  }

  if (username.length < 3) {
    return { isValid: false, error: 'username.errors.too_short' };
  }

  if (username.length > 50) {
    return { isValid: false, error: 'username.errors.too_long' };
  }

  // Allow alphanumeric, underscore, hyphen, and dot
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return { isValid: false, error: 'username.errors.invalid_characters' };
  }

  return { isValid: true };
}

/**
 * Sanitizes input to prevent XSS
 */
export function sanitizeInput(input: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };
  const reg = /[&<>"'/]/ig;
  return input.replace(reg, (match) => map[match]);
}

/**
 * Validates if a string is a valid UUID
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validates URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates if a string contains only alphanumeric characters
 */
export function isAlphanumeric(str: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(str);
}

/**
 * Validates phone number (basic international format)
 */
export function isValidPhoneNumber(phone: string): boolean {
  // Basic international phone validation
  const phoneRegex = /^\+?[\d\s-()]+$/;
  const digitsOnly = phone.replace(/\D/g, '');
  return phoneRegex.test(phone) && digitsOnly.length >= 7 && digitsOnly.length <= 15;
}
