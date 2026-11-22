import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression (smoke D1 desktop, 2026-11-21): the flat Markdown import
 * (Settings -> "Import .md", a folder's "Import .md here") read every picked
 * file. The pickers' `accept` is only a hint and the desktop shell's native
 * open panel (wry) ignores it, so `reborn-notes-export.zip` was imported as a
 * ~4 MB "note" that the server rejects as `too_large` - unsynced for good.
 * The importer now applies folder import's two filters itself (type, then the
 * 500 KB per-note cap) and reports both counters.
 *
 * The filter logic is unit-tested in `markdown-import-utils.spec.ts`; this
 * spec pins its wiring by source text, which keeps it independent of the
 * heavy export-import service graph (@reborn/storage, crypto).
 */
function read(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('reborn-notes importMarkdownFiles - type and size filters (smoke D1)', () => {
  const src = read('./export-import.service.ts');
  const start = src.indexOf('export async function importMarkdownFiles');
  const end = src.indexOf('type DuplicateOutcomeResult');
  const body = src.slice(start, end);

  it('slices the importMarkdownFiles body (anchors present, in order)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('partitions the picked files with the per-note cap before the total cap', () => {
    const partitionIdx = body.indexOf(
      'partitionFlatMarkdownImport(files, MAX_NOTE_CONTENT_BYTES)'
    );
    const totalIdx = body.indexOf('MAX_IMPORT_FILE_SIZE');
    expect(partitionIdx).toBeGreaterThan(-1);
    expect(totalIdx).toBeGreaterThan(partitionIdx);
    expect(body).toMatch(/const totalSize = importable\.reduce/);
  });

  it('reads only the accepted files', () => {
    expect(body).toMatch(/for \(let i = 0; i < importable\.length; i\+\+\)/);
    expect(body).toMatch(/const file = importable\[i\];/);
    expect(body).not.toMatch(/files\[i\]/);
  });

  it('reports both skip counters in the result', () => {
    expect(body).toMatch(/skippedNonMarkdown,\s*skippedTooLarge,/);
  });
});
