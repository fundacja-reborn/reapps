import { describe, it, expect } from 'vitest';
import {
  encryptWithPassword,
  decryptWithPassword,
  PASSWORD_ENVELOPE_ALGORITHM
} from '../password-envelope';
import {
  deriveKeyFromPassword,
  decryptData,
  base64ToArrayBuffer
} from '../encryption';

describe('Password envelope', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const plaintext = JSON.stringify({ hello: 'świat', n: 42, list: [1, 2, 3] });
    const envelope = await encryptWithPassword(plaintext, 'correct horse battery staple');
    const out = await decryptWithPassword(envelope, 'correct horse battery staple');
    expect(out).toBe(plaintext);
  });

  it('emits base64 salt/iv/data and no plaintext leakage', async () => {
    const plaintext = 'super secret note body';
    const envelope = await encryptWithPassword(plaintext, 'pw');
    for (const part of [envelope.salt, envelope.iv, envelope.data]) {
      expect(part).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
    // ciphertext must not contain the plaintext (base64 of UTF-8 anyway)
    expect(envelope.data).not.toContain(plaintext);
  });

  it('uses a fresh salt and IV on every call (non-deterministic)', async () => {
    const a = await encryptWithPassword('same', 'pw');
    const b = await encryptWithPassword('same', 'pw');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('fails to decrypt with the wrong password', async () => {
    const envelope = await encryptWithPassword('payload', 'right');
    await expect(decryptWithPassword(envelope, 'wrong')).rejects.toThrow();
  });

  it('fails to decrypt tampered ciphertext (AES-GCM is authenticated)', async () => {
    const envelope = await encryptWithPassword('payload', 'pw');
    const bytes = base64ToArrayBuffer(envelope.data);
    bytes[0] ^= 0xff;
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const tampered = { ...envelope, data: btoa(binary) };
    await expect(decryptWithPassword(tampered, 'pw')).rejects.toThrow();
  });

  it('is interoperable with the raw deriveKeyFromPassword + decryptData recipe', async () => {
    // Proves the envelope matches the existing portable-backup format, so files
    // produced by this helper decrypt with the steps the import path already uses.
    const plaintext = 'interop check';
    const envelope = await encryptWithPassword(plaintext, 'pw');
    const key = await deriveKeyFromPassword('pw', base64ToArrayBuffer(envelope.salt));
    const out = await decryptData(
      base64ToArrayBuffer(envelope.data),
      key,
      base64ToArrayBuffer(envelope.iv),
      'string'
    );
    expect(out).toBe(plaintext);
  });

  it('exposes the algorithm marker used by existing envelopes', () => {
    expect(PASSWORD_ENVELOPE_ALGORITHM).toBe('aes-256-gcm-pbkdf2');
  });
});
