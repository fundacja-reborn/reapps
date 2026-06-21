import { describe, it, expect } from 'vitest';
import { rewriteInterNoteLinks } from './internal-link-rewrite-utils';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

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

  it('strips a #fragment from the target', () => {
    const map = { 'vault/b.md': UUID_B };
    const { content } = rewriteInterNoteLinks('[B](b.md#heading)', 'vault/a.md', map);
    expect(content).toBe(`[B](note:${UUID_B})`);
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
