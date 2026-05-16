import { describe, it, expect } from 'vitest';
import {
  generateSnapshotKey,
  exportKeyToBase64url,
  importKeyFromBase64url,
  encryptSnapshotPayload,
  decryptSnapshotPayload,
  buildShareUrl,
  parseShareFragment
} from '../snapshot';

describe('Snapshot crypto', () => {
  it('generateSnapshotKey produces a 256-bit AES-GCM key', async () => {
    const key = await generateSnapshotKey();
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(key.extractable).toBe(true);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('export/import key round-trips via base64url', async () => {
    const key = await generateSnapshotKey();
    const exported = await exportKeyToBase64url(key);

    // base64url has no padding, no `+` or `/`
    expect(exported).not.toMatch(/[+/=]/);
    // 32 bytes → 43 base64url chars (no padding)
    expect(exported.length).toBe(43);

    const reimported = await importKeyFromBase64url(exported, true);
    const reExported = await exportKeyToBase64url(reimported);
    expect(reExported).toBe(exported);
  });

  it('importKeyFromBase64url rejects keys of the wrong length', async () => {
    // 12-byte buffer → wrong key length for AES-GCM-256
    const tooShort = Buffer.from(new Uint8Array(12)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    await expect(importKeyFromBase64url(tooShort)).rejects.toThrow(/32 bytes/);
  });

  it('encrypts and decrypts a snapshot payload round-trip', async () => {
    const key = await generateSnapshotKey();
    const payload = {
      type: 'note' as const,
      v: 1 as const,
      title: 'Test note',
      content: '# Hello\n\nThis is **markdown**.',
      shared_at: '2026-05-14T10:00:00.000Z',
      shared_by_label: 'Alice'
    };

    const blob = await encryptSnapshotPayload(payload, key);

    // Wire format: iv:ciphertext (Base64 each, exactly one separator).
    expect(blob).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(blob.split(':').length).toBe(2);

    const decrypted = await decryptSnapshotPayload(blob, key);
    expect(decrypted).toEqual(payload);
  });

  it('decryptSnapshotPayload throws when the key is wrong', async () => {
    const keyA = await generateSnapshotKey();
    const keyB = await generateSnapshotKey();
    const blob = await encryptSnapshotPayload({ type: 'note', v: 1, title: 'x', content: 'y', shared_at: 'z' }, keyA);
    await expect(decryptSnapshotPayload(blob, keyB)).rejects.toThrow();
  });

  it('decryptSnapshotPayload throws on a malformed envelope', async () => {
    const key = await generateSnapshotKey();
    await expect(decryptSnapshotPayload('no-colon-here', key)).rejects.toThrow(/separator/);
  });

  it('buildShareUrl composes the expected URL shape', () => {
    const url = buildShareUrl('https://reapps.eu/notes', 'AbCd1234EfGh5678', 'KEY', 1);
    expect(url).toBe('https://reapps.eu/notes/s/AbCd1234EfGh5678#k=KEY&v=1');
  });

  it('buildShareUrl strips a trailing slash from the base', () => {
    const url = buildShareUrl('https://reapps.eu/notes/', 'slug', 'k', 1);
    expect(url).toBe('https://reapps.eu/notes/s/slug#k=k&v=1');
  });

  it('parseShareFragment extracts key and version', () => {
    expect(parseShareFragment('#k=abc&v=2')).toEqual({ key: 'abc', version: 2 });
    expect(parseShareFragment('k=abc&v=1')).toEqual({ key: 'abc', version: 1 });
  });

  it('parseShareFragment defaults version to 1 when missing', () => {
    expect(parseShareFragment('#k=abc')).toEqual({ key: 'abc', version: 1 });
  });

  it('parseShareFragment returns null when the key is missing', () => {
    expect(parseShareFragment('')).toBeNull();
    expect(parseShareFragment('#v=1')).toBeNull();
  });
});
