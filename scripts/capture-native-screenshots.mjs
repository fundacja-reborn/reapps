#!/usr/bin/env node
/**
 * Store screenshots of the native apps, from a running Android emulator, iOS
 * simulator or the macOS desktop app.
 *
 * The script does the parts that are easy to get wrong by hand and leaves the
 * tapping to a person: it puts a clean status bar on the device (fixed clock,
 * full battery, full signal, no notification icons), switches the system
 * between light and dark, and for each screen on its list says what to open,
 * waits for Enter and saves the picture under a stable name. At the end it
 * puts the status bar and the theme back.
 *
 * It needs a terminal you can type into (it reads Enter from the keyboard),
 * the app installed and signed in on the device, and:
 *   Android: `adb` on PATH, one emulator running
 *   iOS:     Xcode command line tools, one simulator booted
 *   macOS:   the desktop app running (a debug build against the seeded local
 *            stack); the terminal needs Accessibility (window size, theme) and
 *            Screen Recording (the capture) in System Settings > Privacy
 *
 * On macOS there is no status bar: the script sizes the app window to
 * 1440x900 points, which `screencapture` saves as 2880x1800 on a Retina
 * display (1440x900 on another) - both are Mac App Store sizes - and puts the
 * system appearance it found back at the end. For each shot it brings the app
 * to the front (an inactive window has grey traffic lights) and then gives the
 * focus back to the terminal.
 *
 * Usage (from the repo root):
 *   node scripts/capture-native-screenshots.mjs --platform=android
 *   node scripts/capture-native-screenshots.mjs --platform=ios --themes=light
 *   node scripts/capture-native-screenshots.mjs --platform=macos
 *
 * Options:
 *   --platform=android|ios|macos   required
 *   --bundle-id=<id>         macOS: the running app (default eu.reapps.notes.dev)
 *   --lang=<code>            only names the output folder (default en); the UI
 *                            language is whatever the device and the account use
 *   --themes=light,dark      which rounds to run (default light,dark)
 *   --device=<id>            adb serial or simulator UDID when several are running
 *   --out=<dir>              output directory (default tmp/screenshots/native)
 *   --no-status-bar          leave the status bar as it is
 *   --list                   print the screens, then exit
 *
 * Output: <out>/<platform>/<lang>/<nn>-<screen>-<theme>.png, in the pixel
 * size of the device (no frame, no caption).
 *
 * Guideline: reapps-docs/guidelines/84-screenshots.md
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Screens in store order: the first two are the ones a store shows in search
 * results. Titles are the English seed titles (packages/database/src/seed-data.ts).
 */
const SCREENS = [
  { id: 'note-list', say: 'Note list: tap the book icon (All Notes), scroll to the top' },
  {
    id: 'note',
    say: 'Open "Lisbon trip plan" from the list, in Preview: the table and the checkboxes on screen'
  },
  {
    id: 'xray',
    say: 'Encryption X-Ray: in the open note tap the "..." menu in its header, then "Encryption X-Ray"'
  },
  {
    id: 'code',
    say: 'Go back, open "TypeScript course - notes", scroll to a highlighted code block'
  },
  { id: 'folders', say: 'Folders: tap the folder icon, the folder list with colors and icons' },
  { id: 'search', say: 'Search: tap the magnifier icon, type a word (for example "plan")' },
  { id: 'history', say: 'Version history of a note (optional, s to skip)' }
];

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

function fail(message) {
  console.error(`capture-native-screenshots: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  for (const [index, screen] of SCREENS.entries()) {
    console.log(`${String(index + 1).padStart(2, '0')}-${screen.id}: ${screen.say}`);
  }
  process.exit(0);
}

const platform = args.platform;
if (!['android', 'ios', 'macos'].includes(platform)) {
  fail('--platform=android, --platform=ios or --platform=macos');
}
const lang = typeof args.lang === 'string' ? args.lang : 'en';
if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(lang)) fail('--lang must look like "en" or "pt-BR"');
const themes = String(args.themes ?? 'light,dark')
  .split(',')
  .filter(Boolean);
for (const theme of themes) {
  if (theme !== 'light' && theme !== 'dark') fail('--themes takes light and/or dark');
}
const requestedDevice = typeof args.device === 'string' ? args.device : null;
const outDir = resolve(ROOT, String(args.out ?? 'tmp/screenshots/native'), platform, lang);

// -------------------------------------------------------------------- tools

/** Run a tool and return its stdout. `binary` keeps the bytes (a PNG). */
function run(command, commandArgs, { binary = false } = {}) {
  return execFileSync(command, commandArgs, {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/** Same, but a failure is reported and ignored (cosmetic steps). */
function tryRun(command, commandArgs) {
  try {
    run(command, commandArgs);
    return true;
  } catch (error) {
    const text = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(`  (ignored) ${command} ${commandArgs.join(' ')}: ${text}`);
    return false;
  }
}

/** Width and height from a PNG header. */
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// ------------------------------------------------------------------ android

function androidDevice() {
  let output;
  try {
    output = run('adb', ['devices']);
  } catch {
    fail('adb not found or not working. Install Android platform-tools and put adb on PATH.');
  }
  const serials = output
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => parts[0]);
  if (requestedDevice) {
    if (!serials.includes(requestedDevice)) fail(`device ${requestedDevice} is not connected`);
    return requestedDevice;
  }
  if (serials.length === 0) fail('no emulator or device is running (adb devices is empty)');
  if (serials.length > 1) fail(`several devices: ${serials.join(', ')} - pick one with --device=`);
  return serials[0];
}

function android(serial) {
  const adb = (...rest) => ['-s', serial, ...rest];
  const demo = (...extras) =>
    tryRun('adb', adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', ...extras));
  return {
    name: `Android ${serial}`,
    cleanStatusBar() {
      // System UI demo mode: a fixed status bar meant for screenshots.
      tryRun('adb', adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'));
      demo('-e', 'command', 'enter');
      demo('-e', 'command', 'clock', '-e', 'hhmm', '0941');
      demo('-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false');
      // `fully true` = a validated connection; without it Wi-Fi is drawn with
      // a "!" mark (seen on the API 36.1 emulator). The mobile icon stays as
      // the emulator draws it there ("3G", white) whatever datatype is sent,
      // and notification icons stay too - the store graphics are retouched
      // when the shots are placed on their canvas.
      demo(
        '-e',
        'command',
        'network',
        '-e',
        'wifi',
        'show',
        '-e',
        'level',
        '4',
        '-e',
        'fully',
        'true'
      );
      demo(
        '-e',
        'command',
        'network',
        '-e',
        'mobile',
        'show',
        '-e',
        'datatype',
        'lte',
        '-e',
        'level',
        '4',
        '-e',
        'fully',
        'true'
      );
      // Android 16 ignores this one, hence the reminder printed by main().
      demo('-e', 'command', 'notifications', '-e', 'visible', 'false');
    },
    restoreStatusBar() {
      demo('-e', 'command', 'exit');
    },
    setTheme(theme) {
      tryRun('adb', adb('shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no'));
    },
    screenshot(target) {
      const png = run('adb', adb('exec-out', 'screencap', '-p'), { binary: true });
      writeFileSync(target, png);
      return png;
    }
  };
}

// ---------------------------------------------------------------------- ios

function iosDevice() {
  let listing;
  try {
    listing = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']));
  } catch {
    fail('xcrun simctl is not working. Install Xcode and its command line tools.');
  }
  const booted = Object.values(listing.devices ?? {})
    .flat()
    .filter((device) => device.state === 'Booted');
  if (requestedDevice) {
    if (!booted.some((device) => device.udid === requestedDevice)) {
      fail(`simulator ${requestedDevice} is not booted`);
    }
    return requestedDevice;
  }
  if (booted.length === 0) fail('no simulator is booted');
  if (booted.length > 1) {
    fail(
      `several simulators: ${booted.map((d) => `${d.name} ${d.udid}`).join(', ')} - pick one with --device=`
    );
  }
  return booted[0].udid;
}

function ios(udid) {
  return {
    name: `iOS simulator ${udid}`,
    cleanStatusBar() {
      tryRun('xcrun', [
        'simctl',
        'status_bar',
        udid,
        'override',
        '--time',
        '9:41',
        '--dataNetwork',
        'wifi',
        '--wifiMode',
        'active',
        '--wifiBars',
        '3',
        '--cellularMode',
        'active',
        '--cellularBars',
        '4',
        // 'discharging', not 'charged': on iOS 26 'charged' paints a green
        // battery with a bolt, and a store shot wants the plain full one.
        '--batteryState',
        'discharging',
        '--batteryLevel',
        '100'
      ]);
    },
    restoreStatusBar() {
      tryRun('xcrun', ['simctl', 'status_bar', udid, 'clear']);
    },
    setTheme(theme) {
      tryRun('xcrun', ['simctl', 'ui', udid, 'appearance', theme]);
    },
    screenshot(target) {
      run('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', target]);
      return readFileSync(target);
    }
  };
}

// -------------------------------------------------------------------- macos

/** The Mac App Store screenshot size, in points of the window. */
const MAC_WINDOW = { width: 1440, height: 900 };
/** The sizes App Store Connect takes for a Mac app (16:10). */
const MAC_STORE_SIZES = ['1280x800', '1440x900', '2560x1600', '2880x1800'];

/** Blocks for `ms` milliseconds (the capture steps are synchronous). */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function osascript(script, language = 'AppleScript') {
  return run('osascript', ['-l', language, '-e', script]).trim();
}

function macos(bundleId) {
  const processRef = `(first process whose bundle identifier is ${JSON.stringify(bundleId)})`;
  let pid;
  try {
    pid = Number.parseInt(
      osascript(`tell application "System Events" to get unix id of ${processRef}`),
      10
    );
  } catch {
    fail(
      `no running app ${bundleId}, or the terminal may not control System Events.\n` +
        'Start the app, and allow the terminal in System Settings > Privacy & Security > Accessibility.'
    );
  }
  // CoreGraphics through JXA: the window number screencapture -l takes.
  const windowId = () =>
    osascript(
      `ObjC.import('CoreGraphics');
const list = ObjC.deepUnwrap(ObjC.castRefToObject(
  $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID)));
const mine = list.filter((w) => w.kCGWindowOwnerPID === ${pid} && w.kCGWindowLayer === 0);
mine.sort((a, b) => b.kCGWindowBounds.Width * b.kCGWindowBounds.Height
  - a.kCGWindowBounds.Width * a.kCGWindowBounds.Height);
mine.length ? String(mine[0].kCGWindowNumber) : ''`,
      'JavaScript'
    );
  const appearance = 'tell application "System Events" to tell appearance preferences to';
  let initialDark = null;
  return {
    name: `macOS app ${bundleId} (pid ${pid})`,
    cleanStatusBar() {
      // No status bar on a Mac: size the window for the store instead.
      tryRun('osascript', [
        '-e',
        `tell application "System Events" to tell ${processRef} to set position of window 1 to {40, 60}`,
        '-e',
        `tell application "System Events" to tell ${processRef} to set size of window 1 to {${MAC_WINDOW.width}, ${MAC_WINDOW.height}}`
      ]);
    },
    restoreStatusBar() {
      if (initialDark !== null)
        tryRun('osascript', ['-e', `${appearance} set dark mode to ${initialDark}`]);
    },
    setTheme(theme) {
      if (initialDark === null) {
        try {
          initialDark = osascript(`${appearance} get dark mode`) === 'true';
        } catch {
          initialDark = null;
        }
      }
      tryRun('osascript', ['-e', `${appearance} set dark mode to ${theme === 'dark'}`]);
    },
    screenshot(target) {
      // Enter was pressed in the terminal, so the app window is in the
      // background, and macOS draws an inactive window with grey traffic
      // lights (first App Store set, 2026-11-24). Bring the app to the front,
      // give it a moment to redraw as the active window, take the shot, then
      // hand the focus back for the next Enter.
      let before = null;
      try {
        before = osascript(
          'tell application "System Events" to get bundle identifier of first process whose frontmost is true'
        );
      } catch {
        // Not known: the focus stays with the app after the shot.
      }
      tryRun('osascript', [
        '-e',
        `tell application "System Events" to set frontmost of ${processRef} to true`
      ]);
      pause(800);
      try {
        const id = windowId();
        if (!id) throw new Error('no window of the app on screen');
        run('screencapture', ['-o', '-x', `-l${id}`, target]);
      } finally {
        if (before && before !== bundleId) {
          tryRun('osascript', [
            '-e',
            `tell application "System Events" to set frontmost of (first process whose bundle identifier is ${JSON.stringify(before)}) to true`
          ]);
        }
      }
      const png = readFileSync(target);
      const { width, height } = pngSize(png);
      if (!MAC_STORE_SIZES.includes(`${width}x${height}`)) {
        console.warn(
          `  ${width}x${height} is not a Mac App Store size (${MAC_STORE_SIZES.join(', ')}): ` +
            'leave the window at the size the script set, then take it again'
        );
      }
      return png;
    }
  };
}

// --------------------------------------------------------------------- main

async function main() {
  if (!process.stdin.isTTY) {
    fail('this script asks you to press Enter - run it in a terminal you can type into.');
  }

  const device =
    platform === 'android'
      ? android(androidDevice())
      : platform === 'ios'
        ? ios(iosDevice())
        : macos(typeof args['bundle-id'] === 'string' ? args['bundle-id'] : 'eu.reapps.notes.dev');
  mkdirSync(outDir, { recursive: true });
  console.log(`Device: ${device.name}`);
  console.log(`Output: ${outDir}\n`);

  console.log('This script does not tap for you. For each screen it names:');
  console.log(
    `  1. open that screen in the app ${platform === 'macos' ? 'window' : 'on the device'},`
  );
  console.log('  2. come back here and press Enter.');
  if (platform === 'android') {
    console.log('Before the first shot: swipe down on the device and clear the notifications,');
    console.log('so no notification icons are left next to the clock.');
  }
  console.log('');

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const saved = [];
  let quit = false;
  // Bytes of the last shot taken. The demo status bar has a fixed clock, so an
  // unchanged screen gives the very same file - the sign that Enter was
  // pressed before the next screen was opened.
  let previous = null;

  if (!args['no-status-bar']) device.cleanStatusBar();
  try {
    for (const theme of themes) {
      if (quit) break;
      device.setTheme(theme);
      console.log(`--- ${theme} theme (the app follows the system when its theme is "System") ---`);
      for (const [index, screen] of SCREENS.entries()) {
        const name = `${String(index + 1).padStart(2, '0')}-${screen.id}-${theme}.png`;
        let duplicate = false;
        for (;;) {
          const keys = duplicate
            ? `Enter = take ${name} again, k = keep it as it is, s = skip, q = quit`
            : `Enter = take ${name}, s = skip, q = quit`;
          const answer = (await prompt.question(`${duplicate ? '' : `${screen.say}\n`}  ${keys}: `))
            .trim()
            .toLowerCase();
          if (answer === 'q') {
            quit = true;
            break;
          }
          if (answer === 's') {
            if (duplicate) rmSync(join(outDir, name), { force: true });
            break;
          }
          if (duplicate && answer === 'k') {
            saved.push(name);
            console.log('  kept\n');
            break;
          }
          try {
            const png = device.screenshot(join(outDir, name));
            if (previous && png.equals(previous)) {
              duplicate = true;
              console.log(
                '  This is the same picture as the previous shot: the screen on the device has not changed.\n' +
                  '  Open the screen named above on the device first.'
              );
              continue;
            }
            previous = png;
            const { width, height } = pngSize(png);
            saved.push(name);
            const ratio = Math.max(width, height) / Math.min(width, height);
            // Google Play: the long side may be at most twice the short side.
            const note =
              platform === 'android' && ratio > 2
                ? ' - longer than 2:1: for Google Play it has to be placed on a 9:16 canvas'
                : '';
            console.log(`  saved ${width}x${height}${note}\n`);
          } catch (error) {
            console.error(
              `  FAILED: ${error instanceof Error ? error.message.split('\n')[0] : error}\n`
            );
          }
          break;
        }
        if (quit) break;
      }
    }
  } finally {
    prompt.close();
    if (!args['no-status-bar']) device.restoreStatusBar();
    // Emulators and simulators start in light mode; the script does not read
    // the theme it found, so it leaves the usual default behind. A Mac gets
    // back the appearance it had (restoreStatusBar above).
    if (platform !== 'macos') device.setTheme('light');
  }

  console.log(`\n${saved.length} screenshots in ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
