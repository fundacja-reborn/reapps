/**
 * Locks the desktop export facade to the shell's command contract
 * (`src-tauri/src/file_export.rs`): the command name and argument keys are
 * plain strings on both sides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveFileDesktop } from './desktop-file-export';

describe('desktop-file-export', () => {
  const globals = globalThis as { __TAURI__?: unknown };
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async () => ({ saved: true }));
    globals.__TAURI__ = { core: { invoke } };
  });

  afterEach(() => {
    delete globals.__TAURI__;
  });

  it('hands the suggested name and the content to the shell', async () => {
    await expect(saveFileDesktop('notes.zip', 'AP8Q')).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith('file_export_save', { name: 'notes.zip', data: 'AP8Q' });
  });

  it('reports a dismissed dialog without throwing', async () => {
    invoke.mockResolvedValueOnce({ saved: false });

    await expect(saveFileDesktop('notes.zip', 'AP8Q')).resolves.toBe(false);
  });

  it('surfaces a failed write as an Error', async () => {
    invoke.mockRejectedValueOnce('file export: write failed');

    const error = await saveFileDesktop('notes.zip', 'AP8Q').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('file export: write failed');
  });
});
