import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression pins for folder appearance (`metadata_encrypted`) in sync.
 *
 * Source-level checks, same rationale as notes-sync.regression.spec.ts (the
 * sync service pulls in browser-only modules). The decision logic itself is
 * unit-tested in folder-metadata.spec.ts (compareFolderMetadataOnPull); these
 * pins keep the WIRING: before this feature the client neither pushed nor
 * pulled the field, so a color set on one device never reached another and
 * the first pull rebuilt the row without it.
 */

const src = readFileSync(resolve(__dirname, './notes-sync.service.ts'), 'utf-8');

function slice(from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('folder appearance - pull', () => {
  const pull = slice('async function pullFolders', 'async function pullTags');

  it('writes the server bundle into the local row', () => {
    expect(pull).toMatch(/metadata_encrypted:\s*\n?\s*f\.metadata_encrypted === undefined/);
  });

  it('reconciles the bundle through compareFolderMetadataOnPull (adopt vs local edit)', () => {
    expect(pull).toMatch(
      /compareFolderMetadataOnPull\(\s*localFolder\.metadata_encrypted,\s*f\.metadata_encrypted\s*\)/
    );
    expect(pull).toMatch(/metadata === 'local-edit'/);
    expect(pull).toMatch(/metadata === 'adopt'/);
  });
});

describe('folder appearance - push', () => {
  it('pushPendingItems sends the bundle with the folder upsert when set', () => {
    const fn = slice(
      'export async function pushPendingItems',
      '/** Retry a function with exponential backoff'
    );
    const folderPush = fn.slice(fn.indexOf('buildFolderLayers'), fn.indexOf('/folders`, {'));
    expect(folderPush).toMatch(
      /f\.metadata_encrypted \? \{ metadata_encrypted: f\.metadata_encrypted \}/
    );
  });

  it('pushFolder sends the bundle when set; pushFolderUpdate accepts it', () => {
    const create = slice('export function pushFolder(', 'export function pushFolderUpdate');
    expect(create).toMatch(
      /folder\.metadata_encrypted \? \{ metadata_encrypted: folder\.metadata_encrypted \}/
    );
    const update = slice('export function pushFolderUpdate', 'export function pushFolderDelete');
    expect(update).toMatch(/metadata_encrypted\?: string;/);
  });
});

describe('folder appearance - server', () => {
  const read = (rel: string) =>
    readFileSync(resolve(__dirname, '../../routes/api/folders', rel), 'utf-8');

  it('GET returns the bundle; POST/PATCH store it', () => {
    const list = read('+server.ts');
    expect(list).toMatch(/metadata_encrypted: f\.metadata_encrypted/);
    // Upsert update branch only writes the field when the client sent it.
    expect(list).toMatch(/metadata_encrypted !== undefined \? \{ metadata_encrypted \} : \{\}/);
    const item = read('[id]/+server.ts');
    expect(item).toMatch(/updates\.metadata_encrypted = data\.metadata_encrypted/);
  });
});
