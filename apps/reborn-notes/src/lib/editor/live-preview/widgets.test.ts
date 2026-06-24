import { describe, it, expect } from 'vitest';
import { sanitizeInfoClass, sanitizeLinkUrl } from './widgets';

describe('sanitizeLinkUrl', () => {
  it.each([
    ['https://example.com'],
    ['http://example.com/path'],
    ['HTTPS://EXAMPLE.COM'],
    ['ftp://example.com'],
    ['ftps://example.com'],
    ['mailto:user@example.com'],
    ['tel:+48123456789'],
    ['sms:+48123456789'],
    ['xmpp:user@server'],
    ['note:00000000-0000-0000-0000-000000000000'],
    ['note:00000000-0000-0000-0000-000000000000#my-heading'],
    ['/relative/path'],
    ['./relative'],
    ['#anchor']
  ])('allows %s', (url) => {
    expect(sanitizeLinkUrl(url)).toBe(url.trim());
  });

  it.each([
    ['javascript:alert(1)'],
    ['JAVASCRIPT:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['data:image/png;base64,abc'],
    ['vbscript:msgbox(1)'],
    ['file:///etc/passwd'],
    ['javascript:void(0)']
  ])('blocks %s', (url) => {
    expect(sanitizeLinkUrl(url)).toBeNull();
  });

  it('rejects empty/whitespace', () => {
    expect(sanitizeLinkUrl('')).toBeNull();
    expect(sanitizeLinkUrl('   ')).toBeNull();
    expect(sanitizeLinkUrl('\t\n')).toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(sanitizeLinkUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('rejects malformed note: URIs', () => {
    expect(sanitizeLinkUrl('note:not-a-uuid')).toBeNull();
    expect(sanitizeLinkUrl('note:')).toBeNull();
    expect(sanitizeLinkUrl('note:00000000')).toBeNull();
  });
});

describe('sanitizeInfoClass', () => {
  it.each([
    ['js'],
    ['javascript'],
    ['python'],
    ['c++'],
    ['c#'],
    ['F#'],
    ['typescript'],
    ['rust-2024'],
    ['plain_text']
  ])('allows %s', (info) => {
    expect(sanitizeInfoClass(info)).toBe(info.toLowerCase());
  });

  it.each([
    [''],
    ['   '],
    ['has space'],
    ['<script>'],
    ['"quoted"'],
    ['weird/slashes'],
    ['emoji 🎉'],
    ['x'.repeat(33)] // > 32 chars
  ])('rejects %s', (info) => {
    expect(sanitizeInfoClass(info)).toBeNull();
  });

  it('lowercases the result', () => {
    expect(sanitizeInfoClass('JavaScript')).toBe('javascript');
    expect(sanitizeInfoClass('PYTHON')).toBe('python');
  });

  it('trims surrounding whitespace before validating', () => {
    expect(sanitizeInfoClass('  js  ')).toBe('js');
  });
});
