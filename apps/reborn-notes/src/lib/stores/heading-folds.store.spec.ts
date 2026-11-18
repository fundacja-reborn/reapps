import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { foldedSlugsFor, headingFolds } from './heading-folds.store';

const slugs = (noteId: string | null) => foldedSlugsFor(get(headingFolds), noteId);

describe('headingFolds', () => {
  beforeEach(() => {
    headingFolds.reset();
  });

  it('holds the folded sections of one note', () => {
    headingFolds.set('a', ['intro', 'setup']);
    expect(slugs('a')).toEqual(['intro', 'setup']);
    expect(slugs('b')).toEqual([]);
    expect(slugs(null)).toEqual([]);
  });

  it('replaces the list, and another note replaces the held one', () => {
    headingFolds.set('a', ['intro']);
    headingFolds.set('a', ['setup']);
    expect(slugs('a')).toEqual(['setup']);
    headingFolds.set('b', ['other']);
    expect(slugs('a')).toEqual([]);
    expect(slugs('b')).toEqual(['other']);
  });

  it('does not notify when nothing changed', () => {
    headingFolds.set('a', ['intro', 'setup']);
    const seen = vi.fn();
    const stop = headingFolds.subscribe(seen);
    seen.mockClear();
    headingFolds.set('a', ['setup', 'intro']); // same set, other order
    headingFolds.set('b', []); // nothing folded in a note that is not held
    headingFolds.set(null, ['x']);
    expect(seen).not.toHaveBeenCalled();
    headingFolds.set('a', ['intro']);
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });

  it('drops duplicates', () => {
    headingFolds.set('a', ['intro', 'intro']);
    expect(slugs('a')).toEqual(['intro']);
  });

  it('reset forgets everything', () => {
    headingFolds.set('a', ['intro']);
    headingFolds.reset();
    expect(slugs('a')).toEqual([]);
    const seen = vi.fn();
    const stop = headingFolds.subscribe(seen);
    seen.mockClear();
    headingFolds.reset();
    expect(seen).not.toHaveBeenCalled();
    stop();
  });
});
