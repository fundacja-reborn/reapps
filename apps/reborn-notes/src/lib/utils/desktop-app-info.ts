/**
 * Version of the desktop (Tauri) app, from the shell's `app_info` command
 * (`src-tauri/src/app_info.rs`).
 *
 * Desktop counterpart of `App.getInfo()` on the phones: the app's own version
 * and build number (`version` and `bundle > macOS > bundleVersion` in
 * `tauri.conf.json`), independent of the monorepo version of the bundled web
 * build. Also tells which desktop system runs the app, so What's new can pick
 * the entries tagged for it.
 *
 * Desktop-only: callers sit behind `__REBORN_DESKTOP__`.
 */

import type { ReleasePlatform } from '@reborn/i18n';
import { invokeDesktop } from './desktop-bridge';

export interface DesktopAppInfo {
  /** Marketing version, e.g. "0.1.0". */
  version: string;
  /** Build number, e.g. "1". */
  build: string;
  /** Release-notes platform of the running system, or null for an unknown one. */
  platform: ReleasePlatform | null;
}

/** The systems a desktop build can report (Rust's `std::env::consts::OS`). */
const DESKTOP_PLATFORMS: readonly ReleasePlatform[] = ['macos', 'windows', 'linux'];

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** Validate the shell's answer. Null when version or build are missing. */
export function parseDesktopAppInfo(raw: unknown): DesktopAppInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { version, build, platform } = raw as Record<string, unknown>;
  if (!nonEmpty(version) || !nonEmpty(build)) return null;
  return {
    version,
    build,
    platform: DESKTOP_PLATFORMS.find((p) => p === platform) ?? null
  };
}

/** The app's version info, or null when the shell cannot answer. Never rejects. */
export async function getDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  try {
    return parseDesktopAppInfo(await invokeDesktop<unknown>('app_info'));
  } catch {
    return null;
  }
}
