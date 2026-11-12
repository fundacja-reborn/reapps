import { describe, it, expect } from 'vitest';
import { createScrollMemory, isSubPath } from './scroll-memory';

describe('isSubPath', () => {
  it('accepts routes below the parent', () => {
    expect(isSubPath('/settings', '/settings/appearance')).toBe(true);
    expect(isSubPath('/settings', '/settings/security/password')).toBe(true);
    expect(isSubPath('/notes/settings/', '/notes/settings/backup/')).toBe(true);
  });

  it('rejects the same route, siblings and look-alike prefixes', () => {
    expect(isSubPath('/settings', '/settings')).toBe(false);
    expect(isSubPath('/settings', '/settings/')).toBe(false);
    expect(isSubPath('/settings', '/')).toBe(false);
    expect(isSubPath('/settings', '/settings-old/appearance')).toBe(false);
    expect(isSubPath('/settings/appearance', '/settings')).toBe(false);
  });

  it('treats every other route as below the root', () => {
    expect(isSubPath('/', '/settings')).toBe(true);
    expect(isSubPath('/', '/')).toBe(false);
  });
});

describe('scroll memory', () => {
  it('restores the position when the user comes back from a sub-page', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/appearance', 640);
    expect(memory.arrive('/settings', '/settings/appearance')).toBe(640);
  });

  it('restores when coming back from a different sub-page than the one opened', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/security/passcode', 300);
    expect(memory.arrive('/settings/', '/settings/security/app-lock')).toBe(300);
  });

  it('hands the position back only once', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/appearance', 640);
    memory.arrive('/settings', '/settings/appearance');
    expect(memory.arrive('/settings', '/settings/appearance')).toBeUndefined();
  });

  it('starts at the top when the page is opened from elsewhere', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/appearance', 640);
    expect(memory.arrive('/settings', '/')).toBeUndefined();
    // ... and the stale position does not come back on a later return
    expect(memory.arrive('/settings', '/settings/appearance')).toBeUndefined();
  });

  it('starts at the top on first load (no previous page)', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/appearance', 640);
    expect(memory.arrive('/settings', undefined)).toBeUndefined();
  });

  it('forgets the position when the user leaves for a page that is not below it', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/appearance', 640);
    memory.leave('/settings', '/', 120);
    expect(memory.arrive('/settings', '/settings/appearance')).toBeUndefined();
  });

  it('remembers nothing when the container is not mounted or the target is unknown', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/appearance', undefined);
    expect(memory.arrive('/settings', '/settings/appearance')).toBeUndefined();
    memory.leave('/settings', undefined, 640);
    expect(memory.arrive('/settings', '/settings/appearance')).toBeUndefined();
  });

  it('keeps pages apart', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/security', 100);
    memory.leave('/settings/security', '/settings/security/password', 250);
    expect(memory.arrive('/settings/security', '/settings/security/password')).toBe(250);
    expect(memory.arrive('/settings', '/settings/security')).toBe(100);
  });

  it('remembers a position of zero', () => {
    const memory = createScrollMemory();
    memory.leave('/settings', '/settings/appearance', 0);
    expect(memory.arrive('/settings', '/settings/appearance')).toBe(0);
  });
});
