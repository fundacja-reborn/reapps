import { describe, it, expect } from 'vitest';
import {
  buildHeadingLink,
  escapeLinkLabel,
  extractNoteLinkTargets,
  intersectIds,
  remapNoteLinks,
  simplifySelfNoteLinks
} from './note-link-utils';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '123e4567-e89b-12d3-a456-426614174000';
const C = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('extractNoteLinkTargets', () => {
  it('extracts a single internal link target', () => {
    expect([...extractNoteLinkTargets(`See [Note A](note:${A}).`)]).toEqual([A]);
  });

  it('extracts multiple distinct targets', () => {
    const content = `[A](note:${A}) and [B](note:${B}) and [C](note:${C})`;
    expect(extractNoteLinkTargets(content)).toEqual(new Set([A, B, C]));
  });

  it('de-duplicates repeated links to the same note', () => {
    const content = `[x](note:${A}) ... [y](note:${A})`;
    expect([...extractNoteLinkTargets(content)]).toEqual([A]);
  });

  it('excludes the note itself (no self-backlink), case-insensitively', () => {
    const content = `[self](note:${A}) [other](note:${B})`;
    expect(extractNoteLinkTargets(content, A)).toEqual(new Set([B]));
    // selfId given in a different case must still be excluded
    expect(extractNoteLinkTargets(content, A.toUpperCase())).toEqual(new Set([B]));
  });

  it('is case-insensitive and lowercases the captured id', () => {
    const upper = A.toUpperCase();
    expect([...extractNoteLinkTargets(`[a](NOTE:${upper})`)]).toEqual([A]);
  });

  it('ignores external links and other URI schemes', () => {
    const content = `[ext](https://example.com) [mail](mailto:a@b.c) [img](image:${A})`;
    expect(extractNoteLinkTargets(content).size).toBe(0);
  });

  it('does not match a bare note: string that is not a markdown link', () => {
    // No `](` prefix → not a link destination, must not be picked up.
    expect(extractNoteLinkTargets(`reference note:${A} inline`).size).toBe(0);
  });

  it('ignores malformed UUIDs', () => {
    expect(extractNoteLinkTargets(`[bad](note:not-a-uuid)`).size).toBe(0);
    expect(extractNoteLinkTargets(`[short](note:550e8400-e29b-41d4-a716)`).size).toBe(0);
  });

  it('treats an anchored link (note:UUID#slug) as a backlink to the whole note', () => {
    expect([...extractNoteLinkTargets(`[Sec](note:${A}#section)`)]).toEqual([A]);
    // The anchor does not change the target id, so two links to the same note
    // (one anchored, one not) still dedupe to a single backlink.
    expect([...extractNoteLinkTargets(`[a](note:${A}) [b](note:${A}#h)`)]).toEqual([A]);
  });

  it('returns an empty set for empty or link-free content', () => {
    expect(extractNoteLinkTargets('').size).toBe(0);
    expect(extractNoteLinkTargets('Plain text, no links.').size).toBe(0);
  });
});

describe('remapNoteLinks', () => {
  const NEW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const NEW_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('rewrites a link target to its new id, keeping the label', () => {
    const map = new Map([[A, NEW_A]]);
    expect(remapNoteLinks(`See [Note A](note:${A}).`, map)).toBe(`See [Note A](note:${NEW_A}).`);
  });

  it('preserves a #heading anchor while swapping the id', () => {
    const map = new Map([[A, NEW_A]]);
    expect(remapNoteLinks(`[Sec](note:${A}#section)`, map)).toBe(`[Sec](note:${NEW_A}#section)`);
  });

  it('remaps every link, each to its own new id', () => {
    const map = new Map([
      [A, NEW_A],
      [B, NEW_B]
    ]);
    expect(remapNoteLinks(`[a](note:${A}) and [b](note:${B})`, map)).toBe(
      `[a](note:${NEW_A}) and [b](note:${NEW_B})`
    );
  });

  it('leaves a link whose target is not in the map untouched (dangling)', () => {
    // B is not in the map - a link to a note outside the backup stays verbatim.
    const map = new Map([[A, NEW_A]]);
    expect(remapNoteLinks(`[a](note:${A}) [b](note:${B})`, map)).toBe(
      `[a](note:${NEW_A}) [b](note:${B})`
    );
  });

  it('is case-insensitive on the id (uppercase link, lowercase map key)', () => {
    const map = new Map([[A, NEW_A]]);
    expect(remapNoteLinks(`[a](note:${A.toUpperCase()})`, map)).toBe(`[a](note:${NEW_A})`);
  });

  it('does not touch a bare note: mention that is not a link destination', () => {
    const map = new Map([[A, NEW_A]]);
    expect(remapNoteLinks(`ref note:${A} inline`, map)).toBe(`ref note:${A} inline`);
  });

  it('ignores malformed UUIDs', () => {
    const map = new Map([[A, NEW_A]]);
    expect(remapNoteLinks(`[bad](note:not-a-uuid)`, map)).toBe(`[bad](note:not-a-uuid)`);
  });

  it('returns content unchanged for empty content or empty map', () => {
    expect(remapNoteLinks('', new Map([[A, NEW_A]]))).toBe('');
    expect(remapNoteLinks(`[a](note:${A})`, new Map())).toBe(`[a](note:${A})`);
  });
});

describe('intersectIds (mutual links)', () => {
  it('returns the ids present in both lists', () => {
    expect(intersectIds([A, B, C], [B, C])).toEqual(new Set([B, C]));
  });

  it('returns an empty set when there is no overlap', () => {
    expect(intersectIds([A], [B, C]).size).toBe(0);
  });

  it('is case-insensitive and lowercases the result', () => {
    expect(intersectIds([A.toUpperCase()], [A])).toEqual(new Set([A]));
    expect(intersectIds([A], [A.toUpperCase()])).toEqual(new Set([A]));
  });

  it('de-duplicates repeated ids in either input', () => {
    expect([...intersectIds([A, A, B], [A, A])]).toEqual([A]);
  });

  it('returns an empty set when either side is empty', () => {
    expect(intersectIds([], [A, B]).size).toBe(0);
    expect(intersectIds([A, B], []).size).toBe(0);
  });

  it('accepts Set inputs (the graph passes id sets)', () => {
    expect(intersectIds(new Set([A, B]), new Set([B, C]))).toEqual(new Set([B]));
  });
});

describe('simplifySelfNoteLinks', () => {
  it('collapses a self heading link to the bare in-note anchor', () => {
    expect(simplifySelfNoteLinks(`See [Sec](note:${A}#my-section).`, A)).toBe(
      'See [Sec](#my-section).'
    );
  });

  it('is case-insensitive on the id', () => {
    expect(simplifySelfNoteLinks(`[x](note:${A}#h)`, A.toUpperCase())).toBe('[x](#h)');
    expect(simplifySelfNoteLinks(`[x](NOTE:${A.toUpperCase()}#h)`, A)).toBe('[x](#h)');
  });

  it('leaves links to OTHER notes untouched', () => {
    const content = `[self](note:${A}#a) [other](note:${B}#b)`;
    expect(simplifySelfNoteLinks(content, A)).toBe(`[self](#a) [other](note:${B}#b)`);
  });

  it('leaves an anchor-less self link untouched (nothing to collapse to)', () => {
    expect(simplifySelfNoteLinks(`[whole](note:${A})`, A)).toBe(`[whole](note:${A})`);
  });

  it('collapses every self heading link in the text', () => {
    const content = `[a](note:${A}#one) and [b](note:${A}#two)`;
    expect(simplifySelfNoteLinks(content, A)).toBe('[a](#one) and [b](#two)');
  });

  it('preserves Unicode slugs', () => {
    expect(simplifySelfNoteLinks(`[s](note:${A}#sekcja-pierwsza)`, A)).toBe(
      '[s](#sekcja-pierwsza)'
    );
  });

  it('does not touch a bare note: mention that is not a link destination', () => {
    expect(simplifySelfNoteLinks(`ref note:${A}#h inline`, A)).toBe(`ref note:${A}#h inline`);
  });

  it('returns content unchanged for empty inputs', () => {
    expect(simplifySelfNoteLinks('', A)).toBe('');
    expect(simplifySelfNoteLinks(`[x](note:${A}#h)`, '')).toBe(`[x](note:${A}#h)`);
  });
});

describe('buildHeadingLink', () => {
  it('builds the full cross-note form when the note has an id', () => {
    expect(buildHeadingLink(A, 'my-section', 'My Section')).toBe(
      `[My Section](note:${A}#my-section)`
    );
  });

  it('falls back to a bare in-note anchor when there is no id', () => {
    expect(buildHeadingLink(null, 'my-section', 'My Section')).toBe('[My Section](#my-section)');
    expect(buildHeadingLink(undefined, 'h', 'H')).toBe('[H](#h)');
    expect(buildHeadingLink('', 'h', 'H')).toBe('[H](#h)');
  });

  it('escapes characters that would break the link label', () => {
    // input text: A [x] \ B  → label: A \[x\] \\ B
    expect(buildHeadingLink(A, 'a-b', 'A [x] \\ B')).toBe(`[A \\[x\\] \\\\ B](note:${A}#a-b)`);
  });

  it('falls back to the slug as the label when the heading text is empty', () => {
    expect(buildHeadingLink(A, 'only-slug', '')).toBe(`[only-slug](note:${A}#only-slug)`);
    expect(buildHeadingLink(null, 'only-slug', '')).toBe('[only-slug](#only-slug)');
  });

  it('preserves a Unicode slug', () => {
    expect(buildHeadingLink(A, 'bezpieczeństwo', 'Bezpieczeństwo')).toBe(
      `[Bezpieczeństwo](note:${A}#bezpieczeństwo)`
    );
  });

  it('round-trips: a link built for this note self-cleans back to the bare anchor', () => {
    // The Live Preview + Preview copy buttons emit buildHeadingLink(); pasted
    // back into the same note, the editor collapses it via simplifySelfNoteLinks.
    const link = buildHeadingLink(A, 'sec', 'Sec');
    expect(simplifySelfNoteLinks(link, A)).toBe('[Sec](#sec)');
  });
});

describe('escapeLinkLabel', () => {
  it('escapes backslash and square brackets', () => {
    expect(escapeLinkLabel('a[b]c')).toBe('a\\[b\\]c');
    expect(escapeLinkLabel('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary text (including Unicode) untouched', () => {
    expect(escapeLinkLabel('Plain Heading 123 - ąćź')).toBe('Plain Heading 123 - ąćź');
  });
});
