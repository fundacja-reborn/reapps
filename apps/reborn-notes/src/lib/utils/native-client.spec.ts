import { describe, it, expect } from 'vitest';
import { isNativeClient, NATIVE_CLIENT_HEADER, NATIVE_CLIENT_VALUE } from './native-client';

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/auth/login', { method: 'POST', headers });
}

describe('isNativeClient', () => {
  it('is true when the native client header is present with the native value', () => {
    expect(isNativeClient(reqWith({ [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE }))).toBe(true);
  });

  it('is case-insensitive on the header name (Fetch spec normalizes casing)', () => {
    expect(isNativeClient(reqWith({ 'X-Reborn-Client': 'native' }))).toBe(true);
  });

  it('is false when the header is absent (web client - byte-identical path)', () => {
    expect(isNativeClient(reqWith({}))).toBe(false);
  });

  it('is false for any other value (no accidental opt-in)', () => {
    expect(isNativeClient(reqWith({ [NATIVE_CLIENT_HEADER]: 'web' }))).toBe(false);
    expect(isNativeClient(reqWith({ [NATIVE_CLIENT_HEADER]: 'Native' }))).toBe(false);
  });
});
