import { describe, it, expect } from 'vitest';
import {
  emptyTrail,
  freshTrail,
  recordVisit,
  stepBack,
  stepForward,
  removeFromTrail,
  currentId,
  backTargetId,
  forwardTargetId,
  MAX_TRAIL,
  type NavTrail
} from './note-nav-history-utils';

/** Build a trail by recording a sequence of visits from empty. */
function trailOf(...ids: string[]): NavTrail {
  return ids.reduce((t, id) => recordVisit(t, id), emptyTrail());
}

describe('note-nav-history-utils', () => {
  it('an empty trail has no current note and no Back/Forward', () => {
    const t = emptyTrail();
    expect(currentId(t)).toBeNull();
    expect(backTargetId(t)).toBeNull();
    expect(forwardTargetId(t)).toBeNull();
  });

  it('records visits and tracks the current note', () => {
    const t = trailOf('a', 'b');
    expect(currentId(t)).toBe('b');
    expect(backTargetId(t)).toBe('a');
    expect(forwardTargetId(t)).toBeNull();
  });

  it('ignores re-visiting the note already open', () => {
    const t = recordVisit(trailOf('a'), 'a');
    expect(t.entries).toEqual(['a']);
    expect(backTargetId(t)).toBeNull();
  });

  it('freshTrail roots a single-entry trail with no Back/Forward', () => {
    const t = freshTrail('a');
    expect(t.entries).toEqual(['a']);
    expect(currentId(t)).toBe('a');
    expect(backTargetId(t)).toBeNull();
    expect(forwardTargetId(t)).toBeNull();
  });

  it('freshTrail discards an existing chain, so Back closes instead of chaining', () => {
    // a→b were visited (e.g. an earlier section); a fresh top-level open of c
    // must not leave b reachable by Back.
    const existing = trailOf('a', 'b');
    expect(backTargetId(existing)).toBe('a');
    const fresh = freshTrail('c');
    expect(fresh.entries).toEqual(['c']);
    expect(backTargetId(fresh)).toBeNull();
  });

  it('a link visit after a fresh open extends the trail', () => {
    let t = freshTrail('a');
    t = recordVisit(t, 'b'); // internal-link follow
    expect(t.entries).toEqual(['a', 'b']);
    expect(currentId(t)).toBe('b');
    expect(backTargetId(t)).toBe('a');
  });

  it('walks Back and Forward along the trail', () => {
    let t = trailOf('a', 'b', 'c');
    t = stepBack(t);
    expect(currentId(t)).toBe('b');
    t = stepBack(t);
    expect(currentId(t)).toBe('a');
    expect(backTargetId(t)).toBeNull();
    t = stepForward(t);
    expect(currentId(t)).toBe('b');
    expect(forwardTargetId(t)).toBe('c');
  });

  it('truncates the forward trail when a new note is visited after going Back', () => {
    let t = trailOf('a', 'b', 'c');
    t = stepBack(t); // at b, c ahead
    t = recordVisit(t, 'd'); // rewrites the future
    expect(t.entries).toEqual(['a', 'b', 'd']);
    expect(currentId(t)).toBe('d');
    expect(forwardTargetId(t)).toBeNull();
  });

  it('Back / Forward are no-ops at the ends', () => {
    const t = trailOf('a');
    expect(stepBack(t)).toBe(t);
    expect(stepForward(t)).toBe(t);
    expect(currentId(stepBack(t))).toBe('a');
  });

  it('removes every occurrence and keeps the cursor on the same note', () => {
    const t = removeFromTrail(trailOf('a', 'b', 'c'), 'b'); // cursor was on c
    expect(t.entries).toEqual(['a', 'c']);
    expect(currentId(t)).toBe('c');
    expect(backTargetId(t)).toBe('a');
  });

  it('removing the current note shifts the cursor back one step', () => {
    const t = removeFromTrail(trailOf('a', 'b'), 'b'); // cursor was on b
    expect(t.entries).toEqual(['a']);
    expect(currentId(t)).toBe('a');
    expect(forwardTargetId(t)).toBeNull();
  });

  it('removing a note not in the trail is a no-op', () => {
    const t = trailOf('a', 'b');
    expect(removeFromTrail(t, 'zzz')).toBe(t);
  });

  it('removing every entry empties the trail', () => {
    const t = removeFromTrail(trailOf('a'), 'a');
    expect(t.entries).toEqual([]);
    expect(t.cursor).toBe(-1);
    expect(currentId(t)).toBeNull();
  });

  it('caps the trail length, dropping the oldest entries', () => {
    let t = emptyTrail();
    for (let i = 0; i < MAX_TRAIL + 25; i++) t = recordVisit(t, `n${i}`);
    expect(t.entries.length).toBe(MAX_TRAIL);
    expect(currentId(t)).toBe(`n${MAX_TRAIL + 24}`); // newest kept
    expect(t.entries[0]).toBe('n25'); // oldest 25 dropped
  });

  it('treats input trails as immutable (returns new objects)', () => {
    const t0 = trailOf('a', 'b');
    const t1 = recordVisit(t0, 'c');
    expect(t0.entries).toEqual(['a', 'b']);
    expect(t1.entries).toEqual(['a', 'b', 'c']);
  });
});
