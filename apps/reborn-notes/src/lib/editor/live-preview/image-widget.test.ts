import { describe, it, expect } from 'vitest';
import { sanitizeImageSrc, isDataImageUri } from './image-widget';

describe('sanitizeImageSrc', () => {
  it.each([
    ['https://example.com/img.png'],
    ['http://example.com/img.png'],
    ['HTTPS://EXAMPLE.COM/IMG.PNG'],
    ['/relative/img.png'],
    ['./img.png'],
    ['#anchor']
  ])('allows %s', (url) => {
    expect(sanitizeImageSrc(url)).toBe(url.trim());
  });

  it.each([
    ['javascript:alert(1)'],
    ['JAVASCRIPT:alert(1)'],
    ['data:image/png;base64,abc'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['file:///etc/passwd'],
    ['mailto:user@example.com'],
    ['tel:+48123456789'],
    ['note:00000000-0000-0000-0000-000000000000'],
    ['ftp://example.com/img.png']
  ])('blocks %s', (url) => {
    expect(sanitizeImageSrc(url)).toBeNull();
  });

  it('rejects empty/whitespace', () => {
    expect(sanitizeImageSrc('')).toBeNull();
    expect(sanitizeImageSrc('   ')).toBeNull();
    expect(sanitizeImageSrc('\t\n')).toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(sanitizeImageSrc('  https://example.com/img.png  ')).toBe(
      'https://example.com/img.png'
    );
  });
});

describe('isDataImageUri', () => {
  it.each([
    ['data:image/png;base64,abc'],
    ['DATA:image/jpeg;base64,xyz'],
    ['data:text/plain,hello'],
    ['  data:image/png;base64,abc']
  ])('detects %s as data URI', (url) => {
    expect(isDataImageUri(url)).toBe(true);
  });

  it.each([
    ['https://example.com/img.png'],
    ['/relative/img.png'],
    [''],
    ['data-uri-but-not-really']
  ])('rejects %s', (url) => {
    expect(isDataImageUri(url)).toBe(false);
  });
});
