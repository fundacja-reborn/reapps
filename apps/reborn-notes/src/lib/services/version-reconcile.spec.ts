import { describe, it, expect } from 'vitest';
import { versionsDeletedOnServer } from './version-reconcile';

describe('versionsDeletedOnServer (#521)', () => {
  it('removes a synced version the server no longer has (deleted on another device)', () => {
    const local = [
      { id: 'a', sync_status: 'synced' as const },
      { id: 'b', sync_status: 'synced' as const }
    ];
    expect(versionsDeletedOnServer(local, ['a'])).toEqual(['b']);
  });

  it('never removes a pending version - the server has not seen it yet', () => {
    const local = [{ id: 'p', sync_status: 'pending' as const }];
    expect(versionsDeletedOnServer(local, [])).toEqual([]);
  });

  it('keeps synced versions the server still returns', () => {
    const local = [
      { id: 'a', sync_status: 'synced' as const },
      { id: 'b', sync_status: 'synced' as const }
    ];
    expect(versionsDeletedOnServer(local, ['b', 'a', 'z'])).toEqual([]);
  });

  it('an emptied server history removes every synced row and keeps pending ones', () => {
    const local = [
      { id: 'a', sync_status: 'synced' as const },
      { id: 'p', sync_status: 'pending' as const },
      { id: 'b', sync_status: 'synced' as const }
    ];
    expect(versionsDeletedOnServer(local, [])).toEqual(['a', 'b']);
  });

  it('a version still pending when the pull started is kept even if absent from the answer', () => {
    // Its POST may land while the GET is in flight: the row then turns 'synced',
    // but the decision uses the state read BEFORE the request.
    const before = [{ id: 'fresh', sync_status: 'pending' as const }];
    expect(versionsDeletedOnServer(before, [])).toEqual([]);
  });
});
