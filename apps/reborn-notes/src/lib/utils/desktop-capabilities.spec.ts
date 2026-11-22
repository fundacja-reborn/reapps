/**
 * What the page may call in the desktop shell is spread over four places that
 * only meet when the shell is built: the commands registered in
 * `src-tauri/src/lib.rs` (`generate_handler!`), the same list declared to the
 * ACL in `src-tauri/build.rs`, the permissions granted in
 * `src-tauri/capabilities/default.json`, and the calls in this app's code. A
 * command missing from one of them is refused at runtime (a broken feature
 * that only a smoke test would show), and a permission nothing uses is surface
 * for nothing. The Rust tests that check the ACL itself
 * (`src-tauri/src/capability_tests.rs`) do not run in CI, so the lists are
 * compared here.
 *
 * The capability is also pinned as a whole: widening what the page may call
 * (another core API, another plugin, another HTTP origin) has to change this
 * spec too, so it shows up in review.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const srcTauri = new URL('../../../src-tauri/', import.meta.url);
const appSrc = new URL('../../', import.meta.url);

function readShellFile(path: string): string {
  return readFileSync(new URL(path, srcTauri), 'utf8');
}

/** The string items of a Rust `&[ ... ]` slice that follows `marker`. */
function rustStringList(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  expect(start, `${marker} not found`).toBeGreaterThanOrEqual(0);
  const block = /&\[([\s\S]*?)\];/.exec(source.slice(start))?.[1] ?? '';
  return [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

/** Command names registered in `generate_handler![ ... ]` (last path segment). */
function handlerCommands(): string[] {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(readShellFile('src/lib.rs'))?.[1] ?? '';
  return block
    .split(',')
    .map((path) => path.trim().split('::').pop() ?? '')
    .filter(Boolean);
}

/** The permission Tauri generates for an app command: `allow-` + kebab case. */
function allowPermission(command: string): string {
  return `allow-${command.replaceAll('_', '-')}`;
}

/** Every command name this app's code passes to the shell. */
function invokedCommands(): string[] {
  const files = readdirSync(appSrc, { recursive: true, encoding: 'utf8' }).filter(
    (file) => /\.(ts|svelte)$/.test(file) && !/\.(spec|test)\.ts$/.test(file)
  );
  // `invokeDesktop` / `invokeDesktopDialog` from desktop-bridge.ts, and `call`,
  // the error-mapping wrapper of desktop-folder-fs.ts.
  const callSite =
    /\b(?:invokeDesktop|invokeDesktopDialog|call)\s*(?:<[^()]*?>)?\(\s*'([a-z][a-z0-9_]*)'/g;
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(new URL(file, appSrc), 'utf8');
    for (const match of source.matchAll(callSite)) found.add(match[1]);
  }
  return [...found];
}

interface Capability {
  identifier: string;
  windows: string[];
  local?: boolean;
  remote?: unknown;
  webviews?: unknown;
  platforms?: unknown;
  permissions: (string | { identifier: string; allow?: unknown; deny?: unknown })[];
}

const capability = JSON.parse(readShellFile('capabilities/default.json')) as Capability;
const declared = rustStringList(readShellFile('build.rs'), 'const APP_COMMANDS');
const sorted = (list: string[]) => [...list].sort();

describe('desktop shell commands', () => {
  it('declares exactly the registered commands to the ACL', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(sorted(declared)).toEqual(sorted(handlerCommands()));
  });

  it('registers exactly the commands the app calls', () => {
    expect(sorted(invokedCommands())).toEqual(sorted(declared));
  });

  it('tests the ACL with the same command list', () => {
    const tested = rustStringList(readShellFile('src/capability_tests.rs'), 'const PAGE_COMMANDS');
    expect(sorted(tested)).toEqual(sorted(declared));
  });
});

describe('desktop shell capability', () => {
  it('is the only capability of the shell', () => {
    // tauri-build loads every file in capabilities/, so a second file would
    // add permissions without touching this one.
    const files = readdirSync(new URL('capabilities/', srcTauri)).filter(
      (name) => !name.startsWith('.')
    );
    expect(files).toEqual(['default.json']);
  });

  it('applies to the main window and the bundled page only', () => {
    const lib = readShellFile('src/lib.rs');
    const config = JSON.parse(readShellFile('tauri.conf.json')) as {
      app: { windows: { label: string }[] };
    };
    expect(capability.windows).toEqual(['main']);
    expect(lib).toContain('const MAIN_WINDOW: &str = "main";');
    expect(config.app.windows.map((w) => w.label)).toEqual(['main']);
    expect(capability.local).not.toBe(false);
    expect(capability.remote).toBeUndefined();
    expect(capability.webviews).toBeUndefined();
  });

  it('grants each app command by its own permission', () => {
    const granted = capability.permissions.filter(
      (p): p is string => typeof p === 'string' && p.startsWith('allow-')
    );
    expect(sorted(granted)).toEqual(sorted(declared.map(allowPermission)));
  });

  it('grants nothing else but event listening and HTTP to the API origin', () => {
    const rest = capability.permissions.filter(
      (p) => !(typeof p === 'string' && p.startsWith('allow-'))
    );
    expect(rest).toEqual([
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      { identifier: 'http:default', allow: [{ url: 'http://localhost/*' }] }
    ]);
  });
});
