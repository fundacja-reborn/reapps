import type { RequestConfig, RequestInterceptor } from '../types';
import { detectPlaintextLeaks, validateEncryptedPayload } from '@reborn/crypto';

/**
 * Encryption guard interceptor for the Zero-Knowledge sync layer.
 *
 * This interceptor is **validation-only** — it never encrypts data. All
 * services in the application are responsible for producing pre-encrypted
 * payloads (`*_encrypted` fields). The interceptor's job is to refuse any
 * outgoing request whose payload would leak plaintext to the server.
 *
 * For every request bound for an entity endpoint (`/tasks`, `/tasklists`,
 * `/subtasks`, `/notes`, `/folders`, `/tags`) it runs `validateEncryptedPayload`
 * which performs:
 *   - Format validation of every `*_encrypted` field
 *   - Plaintext leak detection (sibling check + KNOWN_SENSITIVE_FIELDS)
 *
 * Any failure throws an `Encryption guard` error and aborts the request —
 * surfacing the bug at the call site instead of leaking data.
 */
export class EncryptionInterceptor implements RequestInterceptor {
  private currentUrl = '';

  setCurrentUrl(url: string): void {
    this.currentUrl = url;
  }

  async onRequest(config: RequestConfig): Promise<RequestConfig> {
    // Skip validation if explicitly disabled (e.g. raw uploads)
    if (config.encrypt === false) {
      return config;
    }

    // Only JSON bodies carry structured entity payloads
    const contentType = this.getContentType(config.headers);
    if (contentType !== 'application/json') {
      return config;
    }

    // Nothing to validate without a body
    if (!config.body) {
      return config;
    }

    // Only entity endpoints carry encrypted data
    if (!this.shouldValidate()) {
      return config;
    }

    // Parse body and validate. Any thrown error is intentionally propagated —
    // better to abort the request than leak plaintext to the server.
    const data = typeof config.body === 'string' ? JSON.parse(config.body) : config.body;
    if (typeof data === 'object' && data !== null) {
      validateEncryptedPayload(data as Record<string, unknown>);
      // On entity endpoints we always run leak detection — even for structural
      // PATCHes that carry no `_encrypted` fields — so a stray plaintext `name`
      // or `title` is caught at the boundary.
      detectPlaintextLeaks(data as Record<string, unknown>);
    }
    return config;
  }

  /**
   * Get Content-Type header value safely
   */
  private getContentType(headers?: HeadersInit): string | undefined {
    if (!headers) return undefined;

    if (headers instanceof Headers) {
      return headers.get('Content-Type') || undefined;
    }

    if (Array.isArray(headers)) {
      const contentTypeHeader = headers.find(([key]) => key.toLowerCase() === 'content-type');
      return contentTypeHeader?.[1];
    }

    if (typeof headers === 'object') {
      // Type assertion for Record<string, string>
      const headerRecord = headers as Record<string, string>;
      return headerRecord['Content-Type'] || headerRecord['content-type'];
    }

    return undefined;
  }

  /**
   * Check if the current endpoint carries encrypted entity data and therefore
   * needs validation.
   */
  private shouldValidate(): boolean {
    const encryptedEndpoints = ['/tasks', '/tasklists', '/subtasks', '/notes', '/folders', '/tags'];
    const url = this.currentUrl || '';
    return encryptedEndpoints.some((endpoint) => url.includes(endpoint));
  }
}
