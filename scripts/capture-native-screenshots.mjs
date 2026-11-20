#!/usr/bin/env node
/**
 * Store screenshots of the native apps, from a running Android emulator or
 * iOS simulator.
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
 *
 * Usage (from the repo root):
 *   node scripts/capture-native-screenshots.mjs --platform=android
 *   node scripts/capture-native-screenshots.mjs --platform=ios --themes=light
 *
 * Options:
 *   --platform=android|ios   required
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Screens in store order: the first two are the ones a store shows in search
 * results. Titles are the English seed titles (packages/database/src/seed-data.ts).
 */
const SCREENS = [
  { id: 'note-list', say: 'Note list: All Notes, scrolled to the top' },
  { id: 'note', say: 'Open "Lisbon trip plan": the table and the checkboxes on screen' },
  {
    id: 'xray',
    say: 'Encryption X-Ray: open a note, the "..." menu in its header, "Encryption X-Ray"'
  },
  { id: 'code', say: 'Open "TypeScript course - notes": a highlighted code block on screen' },
  { id: 'folders', say: 'Folders: the folder list with colors and icons' },
  { id: 'search', say: 'Search: a word typed, results on screen' },
  { id: 'history', say: 'Version history of a note (optional)' }
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
if (platform !== 'android' && platform !== 'ios') fail('--platform=android or --platform=ios');
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
      demo('-e', 'command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4');
      demo(
        '-e',
        'command',
        'network',
        '-e',
        'mobile',
        'show',
        '-e',
        'datatype',
        'none',
        '-e',
        'level',
        '4'
      );
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
        '--batteryState',
        'charged',
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

// --------------------------------------------------------------------- main

async function main() {
  if (!process.stdin.isTTY) {
    fail('this script asks you to press Enter - run it in a terminal you can type into.');
  }

  const device = platform === 'android' ? android(androidDevice()) : ios(iosDevice());
  mkdirSync(outDir, { recursive: true });
  console.log(`Device: ${device.name}`);
  console.log(`Output: ${outDir}\n`);

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const saved = [];
  let quit = false;

  if (!args['no-status-bar']) device.cleanStatusBar();
  try {
    for (const theme of themes) {
      if (quit) break;
      device.setTheme(theme);
      console.log(`--- ${theme} theme (the app follows the system when its theme is "System") ---`);
      for (const [index, screen] of SCREENS.entries()) {
        const name = `${String(index + 1).padStart(2, '0')}-${screen.id}-${theme}.png`;
        const answer = (
          await prompt.question(`${screen.say}\n  Enter = take ${name}, s = skip, q = quit: `)
        )
          .trim()
          .toLowerCase();
        if (answer === 'q') {
          quit = true;
          break;
        }
        if (answer === 's') continue;
        try {
          const png = device.screenshot(join(outDir, name));
          const { width, height } = pngSize(png);
          saved.push(name);
          const ratio = Math.max(width, height) / Math.min(width, height);
          // Google Play: the long side may be at most twice the short side.
          const note =
            platform === 'android' && ratio > 2
              ? ' - longer than 2:1, Play Console may refuse it (crop it or use a 1080x1920 device)'
              : '';
          console.log(`  saved ${width}x${height}${note}\n`);
        } catch (error) {
          console.error(
            `  FAILED: ${error instanceof Error ? error.message.split('\n')[0] : error}\n`
          );
        }
      }
    }
  } finally {
    prompt.close();
    if (!args['no-status-bar']) device.restoreStatusBar();
    // Emulators and simulators start in light mode; the script does not read
    // the theme it found, so it leaves the usual default behind.
    device.setTheme('light');
  }

  console.log(`\n${saved.length} screenshots in ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
