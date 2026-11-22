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
 * The capabilities are also pinned as a whole: widening what the page may
 * call (another core API, another plugin, another HTTP origin) has to change
 * this spec too, so it shows up in review. HTTP to the API is one capability
 * per build (`http-local` for development, `http-production` for the Mac App
 * Store), selected by `app > security > capabilities` of the build's config;
 * each must name exactly the API origin its web build talks to.
 *
 * The build variants (`tauri.conf.json` = development, overlays
 * `tauri.appstore.conf.json` and `tauri.dev-sandbox.conf.json`) and their
 * entitlements are pinned here too: the store build's sandbox, keychain group
 * and bundle identifier must agree, or the shipped app loses its keychain.
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

function readCapability(name: string): Capability {
  return JSON.parse(readShellFile(`capabilities/${name}.json`)) as Capability;
}

const capability = readCapability('default');
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
  it('has one capability for the page and one HTTP capability per build', () => {
    // tauri-build loads every file in capabilities/; the config of each build
    // selects which of them apply (see the variant tests below).
    const files = readdirSync(new URL('capabilities/', srcTauri)).filter(
      (name) => !name.startsWith('.')
    );
    expect(sorted(files)).toEqual(['default.json', 'http-local.json', 'http-production.json']);
  });

  it('applies to the main window and the bundled page only', () => {
    const lib = readShellFile('src/lib.rs');
    const config = readConfig('tauri.conf.json');
    expect(lib).toContain('const MAIN_WINDOW: &str = "main";');
    expect(config.app?.windows?.map((w) => w.label)).toEqual(['main']);
    for (const name of ['default', 'http-local', 'http-production']) {
      const entry = readCapability(name);
      expect(entry.identifier).toBe(name);
      expect(entry.windows).toEqual(['main']);
      expect(entry.local).not.toBe(false);
      expect(entry.remote).toBeUndefined();
      expect(entry.webviews).toBeUndefined();
    }
  });

  it('grants each app command by its own permission', () => {
    const granted = capability.permissions.filter(
      (p): p is string => typeof p === 'string' && p.startsWith('allow-')
    );
    expect(sorted(granted)).toEqual(sorted(declared.map(allowPermission)));
  });

  it('grants the page nothing else but event listening', () => {
    const rest = capability.permissions.filter(
      (p) => !(typeof p === 'string' && p.startsWith('allow-'))
    );
    expect(rest).toEqual(['core:event:allow-listen', 'core:event:allow-unlisten']);
  });

  it('lets each build reach exactly the API origin of its web build', () => {
    expect(readCapability('http-local').permissions).toEqual([
      { identifier: 'http:default', allow: [{ url: `${apiBase('build-desktop-local')}/*` }] }
    ]);
    expect(readCapability('http-production').permissions).toEqual([
      { identifier: 'http:default', allow: [{ url: `${apiBase('build-desktop-prod')}/*` }] }
    ]);
    expect(apiBase('build-desktop-prod')).toBe('https://reapps.eu/notes/api');
  });
});

interface ShellConfig {
  productName?: string;
  identifier?: string;
  app?: {
    windows?: { label: string; create?: boolean }[];
    security?: { capabilities?: unknown[] };
  };
  bundle?: { macOS?: { entitlements?: string; infoPlist?: string; minimumSystemVersion?: string } };
}

function readConfig(name: string): ShellConfig {
  return JSON.parse(readShellFile(name)) as ShellConfig;
}

/** `PUBLIC_API_BASE_URL` of an nx target of this app. */
function apiBase(target: string): string {
  const project = JSON.parse(
    readFileSync(new URL('../../../project.json', import.meta.url), 'utf8')
  ) as {
    targets: Record<string, { options: { command: string } }>;
  };
  const command = project.targets[target]?.options.command ?? '';
  return /\bPUBLIC_API_BASE_URL=(\S+)/.exec(command)?.[1] ?? '';
}

/** Top-level string and array values of an entitlements plist. */
function entitlements(path: string): Record<string, string | string[] | true> {
  const xml = readShellFile(path).replace(/<!--[\s\S]*?-->/g, '');
  const entries: Record<string, string | string[] | true> = {};
  for (const match of xml.matchAll(
    /<key>([^<]+)<\/key>\s*(<true\/>|<string>([^<]*)<\/string>|<array>([\s\S]*?)<\/array>)/g
  )) {
    const [, key, raw, text, items] = match;
    entries[key] =
      raw === '<true/>'
        ? true
        : text !== undefined
          ? text
          : [...(items ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  }
  return entries;
}

/** The entitlements a sandboxed build of `identifier` must carry, no more. */
function sandboxEntitlements(identifier: string) {
  const team = '9ML434R9RK';
  return {
    'com.apple.security.app-sandbox': true,
    'com.apple.security.network.client': true,
    'com.apple.security.files.user-selected.read-write': true,
    'com.apple.security.files.bookmarks.app-scope': true,
    'com.apple.application-identifier': `${team}.${identifier}`,
    'com.apple.developer.team-identifier': team,
    'keychain-access-groups': [`${team}.${identifier}`]
  };
}

describe('desktop shell build variants', () => {
  const base = readConfig('tauri.conf.json');
  const appstore = readConfig('tauri.appstore.conf.json');
  const devSandbox = readConfig('tauri.dev-sandbox.conf.json');

  it('develops under its own identifier against the local stack', () => {
    expect(base.identifier).toBe('eu.reapps.notes.dev');
    expect(base.app?.security?.capabilities).toEqual(['default', 'http-local']);
    // No entitlements without a provisioning profile: macOS kills an app that
    // claims keychain-access-groups without one.
    expect(base.bundle?.macOS?.entitlements).toBeUndefined();
    expect(base.bundle?.macOS?.minimumSystemVersion).toBe('14.0');
  });

  it('creates the main window in Rust, where the link policy is attached', () => {
    expect(base.app?.windows?.[0]?.create).toBe(false);
    expect(readShellFile('src/lib.rs')).toContain('.on_new_window(');
  });

  it('ships the store build as eu.reapps.notes against the production API only', () => {
    expect(appstore.identifier).toBe('eu.reapps.notes');
    expect(appstore.app?.security?.capabilities).toEqual(['default', 'http-production']);
    expect(appstore.bundle?.macOS?.entitlements).toBe('macos/appstore.entitlements');
    expect(entitlements('macos/appstore.entitlements')).toEqual(
      sandboxEntitlements('eu.reapps.notes')
    );
  });

  it('runs the sandboxed development build under the development identifier', () => {
    // Same container and keychain group as the store build would mix a local
    // stack and production in one IndexedDB on the same Mac.
    expect(devSandbox.identifier).toBeUndefined();
    expect(devSandbox.app).toBeUndefined();
    expect(devSandbox.bundle?.macOS?.entitlements).toBe('macos/dev-sandbox.entitlements');
    expect(entitlements('macos/dev-sandbox.entitlements')).toEqual(
      sandboxEntitlements('eu.reapps.notes.dev')
    );
  });
});
