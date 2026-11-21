import { describe, it, expect } from 'vitest';
import { checkUsername, USERNAME_PATTERN } from './username';
import { E2ERegisterRequestSchema, LoginRequestSchema, NewUsernameSchema } from './schemas/api/requests';

describe('checkUsername', () => {
  it.each(['abc', 'jane.doe', 'a.b.c', 'reborn.review', 'user_name', 'user-name', 'A1_b-2.c3', '_a_', '-a-'])(
    'accepts %s',
    (name) => {
      expect(checkUsername(name)).toBeNull();
    }
  );

  it('reports an empty name as required', () => {
    expect(checkUsername('')).toBe('required');
  });

  it('reports length before anything else', () => {
    expect(checkUsername('ab')).toBe('too_short');
    expect(checkUsername('..')).toBe('too_short');
    expect(checkUsername('a'.repeat(51))).toBe('too_long');
    expect(checkUsername('a'.repeat(50))).toBeNull();
  });

  it.each(['jane doe', ' jane', 'jane@doe', 'jane/doe', 'żółw', 'jane​doe', 'a,b,c'])(
    'rejects characters outside the set: %j',
    (name) => {
      expect(checkUsername(name)).toBe('invalid_chars');
    }
  );

  it.each(['.jane', 'jane.', 'jane..doe', '...', 'a.b.', '.a.b'])(
    'rejects a misplaced dot: %s',
    (name) => {
      expect(checkUsername(name)).toBe('invalid_dot');
    }
  );

  it('agrees with USERNAME_PATTERN for every name within the length bounds', () => {
    for (const name of ['abc', 'a.b', 'a..b', '.ab', 'ab.', 'a b', 'a-b', 'a_b', 'a.b-c_d']) {
      expect(checkUsername(name) === null).toBe(USERNAME_PATTERN.test(name));
    }
  });
});

describe('registration schemas use the same rule', () => {
  it('NewUsernameSchema matches checkUsername', () => {
    for (const name of ['jane.doe', 'jane', '.jane', 'jane.', 'ja..ne', 'jane doe', 'ab', 'a'.repeat(51)]) {
      expect(NewUsernameSchema.safeParse(name).success).toBe(checkUsername(name) === null);
    }
  });

  const e2eBody = {
    passwordHash: 'hash',
    encryptedMasterKey: 'iv:ciphertext',
    masterKeySalt: 'salt'
  };

  it('E2E registration accepts a dotted name and rejects a malformed one', () => {
    expect(E2ERegisterRequestSchema.safeParse({ ...e2eBody, username: 'jane.doe' }).success).toBe(true);
    expect(E2ERegisterRequestSchema.safeParse({ ...e2eBody, username: 'jane doe' }).success).toBe(false);
    expect(E2ERegisterRequestSchema.safeParse({ ...e2eBody, username: 'jane..doe' }).success).toBe(false);
    expect(E2ERegisterRequestSchema.safeParse({ ...e2eBody, username: '.jane' }).success).toBe(false);
  });

  it('sign-in keeps the length-only check, so older accounts are not locked out', () => {
    expect(LoginRequestSchema.safeParse({ username: 'jane doe', password: 'password123' }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ username: '.jane.', password: 'password123' }).success).toBe(true);
  });
});
