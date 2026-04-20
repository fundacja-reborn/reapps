import { describe, it, expect, beforeEach } from 'vitest';
import { EncryptionInterceptor } from '../interceptors/encryption';
import type { RequestConfig } from '../types';

const VALID_IV = 'dGVzdGl2MTIzNDU2'; // 16 chars base64
const VALID_CIPHERTEXT = 'Y2lwaGVydGV4dGRhdGE=';
const VALID_ENCRYPTED = `${VALID_IV}:${VALID_CIPHERTEXT}`;

describe('EncryptionInterceptor - validation-only guard', () => {
  let interceptor: EncryptionInterceptor;

  beforeEach(() => {
    interceptor = new EncryptionInterceptor();
  });

  function makeConfig(body: Record<string, unknown>, url = '/api/notes'): RequestConfig {
    interceptor.setCurrentUrl(url);
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
  }

  it('passes through valid encrypted payload without throwing', async () => {
    const config = makeConfig({
      id: 'note-1',
      title_encrypted: VALID_ENCRYPTED,
      content_encrypted: VALID_ENCRYPTED
    });

    const result = await interceptor.onRequest(config);
    expect(result).toBeDefined();
  });

  it('throws when encrypted field contains plaintext', async () => {
    const config = makeConfig({
      id: 'note-1',
      title_encrypted: 'Buy groceries',
      content_encrypted: VALID_ENCRYPTED
    });

    await expect(interceptor.onRequest(config)).rejects.toThrow('Encryption guard');
  });

  it('throws when encrypted field has invalid format (no separator)', async () => {
    const config = makeConfig(
      {
        id: 'task-1',
        title_encrypted: 'justbase64withoutcolon'
      },
      '/api/tasks'
    );

    await expect(interceptor.onRequest(config)).rejects.toThrow('Encryption guard');
  });

  it('passes for endpoints without encrypted data', async () => {
    const config = makeConfig(
      {
        username: 'testuser',
        password: 'secret'
      },
      '/api/auth/login'
    );

    const result = await interceptor.onRequest(config);
    expect(result).toBeDefined();
  });

  it('skips null values in encrypted fields', async () => {
    const config = makeConfig(
      {
        id: 'tag-1',
        name_encrypted: VALID_ENCRYPTED,
        color_encrypted: null
      },
      '/api/tags'
    );

    const result = await interceptor.onRequest(config);
    expect(result).toBeDefined();
  });

  it('validates folder payload', async () => {
    const config = makeConfig(
      {
        id: 'folder-1',
        name_encrypted: VALID_ENCRYPTED,
        parent_id: null,
        order_index: 0
      },
      '/api/folders'
    );

    const result = await interceptor.onRequest(config);
    expect(result).toBeDefined();
  });

  it('skips validation when encrypt is false', async () => {
    interceptor.setCurrentUrl('/api/notes');
    const config: RequestConfig = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title_encrypted: 'plaintext' }),
      encrypt: false
    };

    // Should not throw because encrypt is explicitly disabled
    const result = await interceptor.onRequest(config);
    expect(result).toBeDefined();
  });

  it('throws when plaintext sibling field accompanies an encrypted field', async () => {
    const config = makeConfig(
      {
        id: 'note-1',
        title: 'Buy groceries',
        title_encrypted: VALID_ENCRYPTED,
        content_encrypted: VALID_ENCRYPTED
      },
      '/api/notes'
    );

    await expect(interceptor.onRequest(config)).rejects.toThrow(/plaintext field "title"/);
  });

  it('throws when known-sensitive plaintext field is present on entity payload', async () => {
    const config = makeConfig(
      {
        id: 'task-1',
        title_encrypted: VALID_ENCRYPTED,
        description: 'leaked'
      },
      '/api/tasks'
    );

    await expect(interceptor.onRequest(config)).rejects.toThrow(/known-sensitive field "description"/);
  });

  it('does not encrypt plaintext payloads — pure validation only', async () => {
    // A payload with sensitive plaintext on a non-entity endpoint must pass through.
    // This used to be auto-encrypted; the interceptor is now validation-only.
    const config = makeConfig(
      { username: 'alice', password: 'secret' },
      '/api/auth/register'
    );
    const result = await interceptor.onRequest(config);
    expect(result.body).toBe(JSON.stringify({ username: 'alice', password: 'secret' }));
  });

  it('passes structural-only PATCH (no encrypted fields) on entity endpoint', async () => {
    // Folder move: only parent_id changes, no encrypted fields involved.
    const config = makeConfig(
      { parent_id: 'folder-99' },
      '/api/folders/folder-1'
    );
    const result = await interceptor.onRequest(config);
    expect(result).toBeDefined();
  });

  it('throws on plaintext-only PATCH that smuggles a sensitive field on entity endpoint', async () => {
    // Folder rename gone wrong: developer forgot to encrypt `name`.
    // Even without an `_encrypted` field, the interceptor must catch this.
    const config = makeConfig({ name: 'New folder name' }, '/api/folders/folder-1');
    await expect(interceptor.onRequest(config)).rejects.toThrow(/known-sensitive field "name"/);
  });
});
