import { describe, expect, it } from 'vitest';
import { shareDeepLinkToRoute } from './deep-link';

describe('shareDeepLinkToRoute', () => {
  it('maps a prod share link to the in-app route, keeping the key fragment', () => {
    expect(shareDeepLinkToRoute('https://reapps.eu/notes/s/AbCd1234EfGh5678#k=KEY&v=1')).toBe(
      '/s/AbCd1234EfGh5678#k=KEY&v=1'
    );
  });

  it('handles the staging host', () => {
    expect(shareDeepLinkToRoute('https://staging.reapps.eu/notes/s/XyZ#k=K')).toBe('/s/XyZ#k=K');
  });

  it('handles the local-emulator host', () => {
    expect(shareDeepLinkToRoute('http://10.0.2.2/notes/s/SLUG#k=K&v=1')).toBe('/s/SLUG#k=K&v=1');
  });

  it('tolerates a trailing slash on the slug', () => {
    expect(shareDeepLinkToRoute('https://reapps.eu/notes/s/ABC/')).toBe('/s/ABC');
  });

  it('returns a fragment-less route when the link carries no key (page shows missing-key)', () => {
    expect(shareDeepLinkToRoute('https://reapps.eu/notes/s/ABC')).toBe('/s/ABC');
  });

  it('returns null for a non-share path', () => {
    expect(shareDeepLinkToRoute('https://reapps.eu/notes/')).toBeNull();
    expect(shareDeepLinkToRoute('https://reapps.eu/notes/settings')).toBeNull();
  });

  it('returns null for a share path with no slug', () => {
    expect(shareDeepLinkToRoute('https://reapps.eu/notes/s/')).toBeNull();
  });

  it('returns null for a nested path beyond the slug', () => {
    expect(shareDeepLinkToRoute('https://reapps.eu/notes/s/ABC/extra')).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(shareDeepLinkToRoute('not a url')).toBeNull();
    expect(shareDeepLinkToRoute('')).toBeNull();
  });
});
