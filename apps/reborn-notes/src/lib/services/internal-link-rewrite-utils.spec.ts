import { describe, it, expect } from 'vitest';
import { rewriteInterNoteLinks, buildWikilinkIndex } from './internal-link-rewrite-utils';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

describe('rewriteInterNoteLinks', () => {
  it('rewrites a same-directory relative .md link to a note: link', () => {
    const map = { 'vault/b.md': UUID_B };
    const { content, rewritten } = rewriteInterNoteLinks('See [B](b.md).', 'vault/a.md', map);
    expect(content).toBe(`See [B](note:${UUID_B}).`);
    expect(rewritten).toBe(1);
  });

  it('resolves subdirectory targets', () => {
    const map = { 'vault/sub/b.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[B](sub/b.md)', 'vault/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B})`);
  });

  it('resolves ../ parent traversal', () => {
    const map = { 'vault/other/c.md': UUID_C };
    const { content } = rewriteInterNoteLinks('[C](../other/c.md)', 'vault/sub/a.md', map);
    expect(content).toBe(`[C](note:${UUID_C})`);
  });

  it('resolves ./ explicit current dir', () => {
    const map = { 'vault/sub/b.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[B](./b.md)', 'vault/sub/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B})`);
  });

  it('preserves a #fragment as a heading anchor', () => {
    const map = { 'vault/b.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[B](b.md#heading)', 'vault/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B}#heading)`);
  });

  it('percent-decodes then slugifies an encoded heading fragment', () => {
    const map = { 'vault/b.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[B](b.md#Some%20Section)', 'vault/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B}#some-section)`);
  });

  it('keeps the anchored note: link stable on a second pass (idempotent)', () => {
    const map = { 'vault/b.md': UUID_B };
    const once = rewriteInterNoteLinks('[B](b.md#heading)', 'vault/a.md', map).content;
    const twice = rewriteInterNoteLinks(once, 'vault/a.md', map).content;
    expect(twice).toBe(once);
  });

  it('percent-decodes spaces in the path', () => {
    const map = { 'vault/my note.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[N](my%20note.md)', 'vault/a.md', map);
    expect(content).toBe(`[N](note:${UUID_B})`);
  });

  it('matches case-insensitively when no exact key exists', () => {
    const map = { 'vault/Note.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[N](note.md)', 'vault/a.md', map);
    expect(content).toBe(`[N](note:${UUID_B})`);
  });

  it('prefers an exact case match over the case-insensitive fallback', () => {
    const map = { 'vault/Note.md': UUID_B, 'vault/note.md': UUID_C };
    const { content } = rewriteInterNoteLinks('[N](note.md)', 'vault/a.md', map);
    expect(content).toBe(`[N](note:${UUID_C})`);
  });

  it('preserves an optional link title', () => {
    const map = { 'vault/b.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[B](b.md "Tooltip")', 'vault/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B} "Tooltip")`);
  });

  it('handles angle-bracketed destinations', () => {
    const map = { 'vault/my note.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[N](<my note.md>)', 'vault/a.md', map);
    expect(content).toBe(`[N](note:${UUID_B})`);
  });

  it('rewrites multiple links and counts them', () => {
    const map = { 'vault/b.md': UUID_B, 'vault/c.md': UUID_C };
    const { content, rewritten } = rewriteInterNoteLinks(
      'Go to [B](b.md) then [C](c.md).',
      'vault/a.md',
      map
    );
    expect(content).toBe(`Go to [B](note:${UUID_B}) then [C](note:${UUID_C}).`);
    expect(rewritten).toBe(2);
  });

  // ── Things that must be left untouched ──────────────────────────────────

  it('leaves images/embeds untouched', () => {
    const map = { 'vault/pic.md': UUID_B };
    const input = '![alt](pic.md)';
    expect(rewriteInterNoteLinks(input, 'vault/a.md', map).content).toBe(input);
  });

  it('leaves external links untouched', () => {
    const map = { 'vault/b.md': UUID_B };
    const input = '[site](https://example.com/b.md)';
    expect(rewriteInterNoteLinks(input, 'vault/a.md', map).content).toBe(input);
  });

  it('leaves already-rewritten note: links untouched (idempotent)', () => {
    const map = { 'vault/b.md': UUID_B };
    const input = `[B](note:${UUID_B})`;
    const once = rewriteInterNoteLinks('[B](b.md)', 'vault/a.md', map).content;
    const twice = rewriteInterNoteLinks(once, 'vault/a.md', map).content;
    expect(once).toBe(input);
    expect(twice).toBe(input);
  });

  it('leaves anchor-only and absolute targets untouched', () => {
    const map = { 'vault/b.md': UUID_B };
    expect(rewriteInterNoteLinks('[x](#section)', 'vault/a.md', map).content).toBe('[x](#section)');
    expect(rewriteInterNoteLinks('[x](/b.md)', 'vault/a.md', map).content).toBe('[x](/b.md)');
  });

  it('leaves non-.md targets untouched', () => {
    const map = { 'vault/b.md': UUID_B };
    const input = '[doc](report.pdf)';
    expect(rewriteInterNoteLinks(input, 'vault/a.md', map).content).toBe(input);
  });

  it('leaves links to unknown targets untouched', () => {
    const map = { 'vault/b.md': UUID_B };
    const input = '[missing](nope.md)';
    expect(rewriteInterNoteLinks(input, 'vault/a.md', map).content).toBe(input);
  });

  it('leaves ../ targets that escape the vault untouched', () => {
    const map = { 'vault/b.md': UUID_B };
    const input = '[B](../../b.md)';
    expect(rewriteInterNoteLinks(input, 'vault/a.md', map).content).toBe(input);
  });

  it('does not rewrite links inside inline code', () => {
    const map = { 'vault/b.md': UUID_B };
    const input = 'Use `[B](b.md)` literally.';
    expect(rewriteInterNoteLinks(input, 'vault/a.md', map).content).toBe(input);
  });

  it('does not rewrite links inside fenced code blocks', () => {
    const map = { 'vault/b.md': UUID_B };
    const input = '```\n[B](b.md)\n```';
    expect(rewriteInterNoteLinks(input, 'vault/a.md', map).content).toBe(input);
  });

  it('rewrites a link outside code but not the one inside', () => {
    const map = { 'vault/b.md': UUID_B };
    const { content, rewritten } = rewriteInterNoteLinks(
      'Real [B](b.md) and `[B](b.md)`.',
      'vault/a.md',
      map
    );
    expect(content).toBe(`Real [B](note:${UUID_B}) and \`[B](b.md)\`.`);
    expect(rewritten).toBe(1);
  });

  it('returns the input unchanged with an empty map', () => {
    const input = '[B](b.md)';
    const result = rewriteInterNoteLinks(input, 'vault/a.md', {});
    expect(result.content).toBe(input);
    expect(result.rewritten).toBe(0);
  });

  it('accepts a Map as well as a plain object', () => {
    const map = new Map([['vault/b.md', UUID_B]]);
    const { content } = rewriteInterNoteLinks('[B](b.md)', 'vault/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B})`);
  });

  it('resolves a link from a root-level file', () => {
    const map = { 'vault/b.md': UUID_A };
    const { content } = rewriteInterNoteLinks('[B](b.md)', 'vault/index.md', map);
    expect(content).toBe(`[B](note:${UUID_A})`);
  });
});

// ── Obsidian wikilinks ────────────────────────────────────────────────────

/** Rewrite `content` with a wikilink index derived from the same path→id map. */
function wiki(content: string, currentPath: string, map: Record<string, string>) {
  return rewriteInterNoteLinks(content, currentPath, map, { wikilinks: buildWikilinkIndex(map) });
}

describe('buildWikilinkIndex', () => {
  it('indexes a unique basename and its vault-relative path', () => {
    const idx = buildWikilinkIndex({ 'vault/sub/Note.md': UUID_B });
    expect(idx.byBasename.get('note')).toBe(UUID_B);
    expect(idx.byPath.get('sub/note')).toBe(UUID_B); // root "vault" stripped
  });

  it('drops a basename shared by two distinct notes (ambiguous)', () => {
    const idx = buildWikilinkIndex({ 'vault/x/Note.md': UUID_B, 'vault/y/Note.md': UUID_C });
    expect(idx.byBasename.has('note')).toBe(false);
    // …but each full path still resolves unambiguously.
    expect(idx.byPath.get('x/note')).toBe(UUID_B);
    expect(idx.byPath.get('y/note')).toBe(UUID_C);
  });

  it('keeps a basename that maps to ONE note carried under two paths', () => {
    // Folder sync: the same note appears under this run's path and the manifest.
    const idx = buildWikilinkIndex({ 'vault/Note.md': UUID_B, 'vault/old/Note.md': UUID_B });
    expect(idx.byBasename.get('note')).toBe(UUID_B);
  });

  it('strips no root when keys do not share a first segment', () => {
    const idx = buildWikilinkIndex({ 'a/Note.md': UUID_B, 'b/Other.md': UUID_C });
    expect(idx.byPath.get('a/note')).toBe(UUID_B);
    expect(idx.byPath.get('b/other')).toBe(UUID_C);
  });
});

describe('rewriteInterNoteLinks - wikilinks', () => {
  it('rewrites a bare [[Note]] to a note: link by unique basename', () => {
    const map = { 'vault/B.md': UUID_B };
    const { content, rewritten } = rewriteInterNoteLinks('See [[B]].', 'vault/a.md', map, {
      wikilinks: buildWikilinkIndex(map)
    });
    expect(content).toBe(`See [B](note:${UUID_B}).`);
    expect(rewritten).toBe(1);
  });

  it('uses the alias as the link label', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[B|the bee]]', 'vault/a.md', map).content).toBe(`[the bee](note:${UUID_B})`);
  });

  it('keeps a #heading subpath as a note anchor and labels with the target', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[B#Section]]', 'vault/a.md', map).content).toBe(`[B](note:${UUID_B}#section)`);
  });

  it('slugifies a multi-word heading subpath', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[B#Some Long Heading]]', 'vault/a.md', map).content).toBe(
      `[B](note:${UUID_B}#some-long-heading)`
    );
  });

  it('drops a #^block subpath (no heading equivalent)', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[B#^block1]]', 'vault/a.md', map).content).toBe(`[B](note:${UUID_B})`);
  });

  it('combines #heading and |alias', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[B#Section|go]]', 'vault/a.md', map).content).toBe(
      `[go](note:${UUID_B}#section)`
    );
  });

  it('resolves a path-form wikilink [[sub/C]]', () => {
    const map = { 'vault/sub/C.md': UUID_C, 'vault/a.md': UUID_A };
    expect(wiki('[[sub/C]]', 'vault/a.md', map).content).toBe(`[sub/C](note:${UUID_C})`);
  });

  it('resolves a basename case-insensitively', () => {
    const map = { 'vault/Note.md': UUID_B };
    expect(wiki('[[note]]', 'vault/a.md', map).content).toBe(`[note](note:${UUID_B})`);
  });

  it('accepts an explicit .md extension in the target', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[B.md]]', 'vault/a.md', map).content).toBe(`[B.md](note:${UUID_B})`);
  });

  it('disambiguates a shared basename via the path form', () => {
    const map = { 'vault/x/Note.md': UUID_B, 'vault/y/Note.md': UUID_C };
    expect(wiki('[[x/Note]]', 'vault/a.md', map).content).toBe(`[x/Note](note:${UUID_B})`);
  });

  it('rewrites several wikilinks and counts them', () => {
    const map = { 'vault/B.md': UUID_B, 'vault/C.md': UUID_C };
    const { content, rewritten } = wiki('[[B]] and [[C]]', 'vault/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B}) and [C](note:${UUID_C})`);
    expect(rewritten).toBe(2);
  });

  it('counts path links and wikilinks together', () => {
    const map = { 'vault/B.md': UUID_B, 'vault/C.md': UUID_C };
    const { content, rewritten } = wiki('[B](B.md) then [[C]]', 'vault/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B}) then [C](note:${UUID_C})`);
    expect(rewritten).toBe(2);
  });

  // ── Left untouched ───────────────────────────────────────────────────────

  it('leaves a wikilink untouched when no index is supplied', () => {
    const map = { 'vault/B.md': UUID_B };
    // Path-link-only call (no opts) — wikilinks are not in scope.
    expect(rewriteInterNoteLinks('[[B]]', 'vault/a.md', map).content).toBe('[[B]]');
  });

  it('leaves an ambiguous bare [[Note]] untouched', () => {
    const map = { 'vault/x/Note.md': UUID_B, 'vault/y/Note.md': UUID_C };
    expect(wiki('[[Note]]', 'vault/a.md', map).content).toBe('[[Note]]');
  });

  it('leaves an unresolved [[Missing]] untouched', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[Missing]]', 'vault/a.md', map).content).toBe('[[Missing]]');
  });

  it('leaves a path-form target that does not exist untouched', () => {
    const map = { 'vault/B.md': UUID_B };
    // basename B is unique, but the path form must match a real path exactly.
    expect(wiki('[[wrong/B]]', 'vault/a.md', map).content).toBe('[[wrong/B]]');
  });

  it('leaves embeds ![[..]] untouched', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('![[B]]', 'vault/a.md', map).content).toBe('![[B]]');
  });

  it('converts a same-note [[#Heading]] to an in-note anchor', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[#Section]]', 'vault/a.md', map).content).toBe('[Section](#section)');
  });

  it('converts a same-note [[#Heading|alias]] to an in-note anchor', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[#Some Section|here]]', 'vault/a.md', map).content).toBe('[here](#some-section)');
  });

  it('leaves a same-note [[#^block]] untouched (no heading equivalent)', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('[[#^block1]]', 'vault/a.md', map).content).toBe('[[#^block1]]');
  });

  it('does not rewrite a wikilink inside inline code', () => {
    const map = { 'vault/B.md': UUID_B };
    expect(wiki('Type `[[B]]` literally.', 'vault/a.md', map).content).toBe('Type `[[B]]` literally.');
  });

  it('does not rewrite a wikilink inside a fenced block', () => {
    const map = { 'vault/B.md': UUID_B };
    const input = '```\n[[B]]\n```';
    expect(wiki(input, 'vault/a.md', map).content).toBe(input);
  });

  it('rewrites a wikilink outside code but not the one inside', () => {
    const map = { 'vault/B.md': UUID_B };
    const { content, rewritten } = wiki('Real [[B]] and `[[B]]`.', 'vault/a.md', map);
    expect(content).toBe(`Real [B](note:${UUID_B}) and \`[[B]]\`.`);
    expect(rewritten).toBe(1);
  });

  it('is idempotent: a rewritten wikilink is a note: link on the second pass', () => {
    const map = { 'vault/B.md': UUID_B };
    const once = wiki('[[B]]', 'vault/a.md', map).content;
    const twice = wiki(once, 'vault/a.md', map).content;
    expect(once).toBe(`[B](note:${UUID_B})`);
    expect(twice).toBe(`[B](note:${UUID_B})`);
  });

  it('rewrites wikilinks even when the path-link map has no usable targets', () => {
    // Only this note in the map, but it can still link to itself by name.
    const map = { 'vault/Self.md': UUID_D };
    expect(wiki('[[Self]]', 'vault/Self.md', map).content).toBe(`[Self](note:${UUID_D})`);
  });
});
