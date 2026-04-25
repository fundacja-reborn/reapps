import { describe, it, expect } from 'vitest';
import type { FolderEncrypted } from '@reborn/types';
import { buildFolderLayers } from './folder-push-order';

function f(id: string, parent_id: string | null = null): FolderEncrypted {
  return {
    id,
    user_id: 'u',
    parent_id: parent_id ?? undefined,
    name_encrypted: 'enc',
    order_index: 0,
    is_archived: false,
    sync_status: 'pending',
    sync_version: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  };
}

function ids(layer: FolderEncrypted[]): string[] {
  return layer.map((x) => x.id).sort();
}

describe('buildFolderLayers', () => {
  it('empty → no layers', () => {
    expect(buildFolderLayers([])).toEqual([]);
  });

  it('flat list of roots → single layer', () => {
    const layers = buildFolderLayers([f('a'), f('b'), f('c')]);
    expect(layers).toHaveLength(1);
    expect(ids(layers[0])).toEqual(['a', 'b', 'c']);
  });

  it('two-level tree → two layers (root before child)', () => {
    const layers = buildFolderLayers([f('child', 'root'), f('root')]);
    expect(layers).toHaveLength(2);
    expect(ids(layers[0])).toEqual(['root']);
    expect(ids(layers[1])).toEqual(['child']);
  });

  it('three-level chain → three layers', () => {
    const layers = buildFolderLayers([f('c', 'b'), f('b', 'a'), f('a')]);
    expect(layers).toHaveLength(3);
    expect(ids(layers[0])).toEqual(['a']);
    expect(ids(layers[1])).toEqual(['b']);
    expect(ids(layers[2])).toEqual(['c']);
  });

  it('siblings group into the same layer', () => {
    const layers = buildFolderLayers([
      f('root'),
      f('a', 'root'),
      f('b', 'root'),
      f('c', 'root')
    ]);
    expect(layers).toHaveLength(2);
    expect(ids(layers[0])).toEqual(['root']);
    expect(ids(layers[1])).toEqual(['a', 'b', 'c']);
  });

  it("parent already on server (not in pending) → child goes to layer 0", () => {
    // Parent 'srv' isn't in the pending list — server already has it. Child
    // can push immediately without waiting for any other layer.
    const layers = buildFolderLayers([f('child', 'srv')]);
    expect(layers).toHaveLength(1);
    expect(ids(layers[0])).toEqual(['child']);
  });

  it('mixed: roots, server-parented, and nested all in one batch', () => {
    const layers = buildFolderLayers([
      f('root1'), // layer 0
      f('serverChild', 'serverParent'), // layer 0 (parent not pending)
      f('a', 'root1'), // layer 1
      f('grand', 'a') // layer 2
    ]);
    expect(layers).toHaveLength(3);
    expect(ids(layers[0])).toEqual(['root1', 'serverChild']);
    expect(ids(layers[1])).toEqual(['a']);
    expect(ids(layers[2])).toEqual(['grand']);
  });

  it('every folder appears exactly once across layers', () => {
    const input = [
      f('root'),
      f('a', 'root'),
      f('b', 'root'),
      f('c', 'a'),
      f('d', 'b'),
      f('e', 'c')
    ];
    const layers = buildFolderLayers(input);
    const flat = layers.flat().map((x) => x.id).sort();
    expect(flat).toEqual(['a', 'b', 'c', 'd', 'e', 'root']);
  });

  it('cycle: leftovers are appended as a final layer instead of dropped', () => {
    // Synthetic cycle a→b→a. Cannot occur with valid server-side data, but
    // the helper must not loop forever or silently drop folders.
    const layers = buildFolderLayers([f('a', 'b'), f('b', 'a')]);
    expect(layers).toHaveLength(1);
    expect(ids(layers[0])).toEqual(['a', 'b']);
  });
});
