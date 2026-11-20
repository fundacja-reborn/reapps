#!/usr/bin/env node
/**
 * Web screenshots of re/notes and re/task for the website and the README.
 *
 * Drives the system Chrome through playwright-core (no browser download)
 * against a LOCAL stack filled by `pnpm db:seed`, takes the raw screens and
 * composes them into the images the site uses (same file names and canvas
 * sizes as `reapps-www/public/screenshots`, so nothing changes on the site
 * but the pictures).
 *
 * Usage (from the repo root, local stack running):
 *   pnpm db:seed -- --lang en
 *   node scripts/capture-screenshots.mjs --lang=en
 *   pnpm db:seed -- --lang pl
 *   node scripts/capture-screenshots.mjs --lang=pl
 *
 * Options:
 *   --lang=en|pl          language of the seeded data and of the UI (default en)
 *   --base=<url>          origin serving /notes and /task (default http://localhost)
 *   --notes-url=<url>     re/notes root, overrides --base (dev server: http://localhost:4201)
 *   --task-url=<url>      re/task root, overrides --base (dev server: http://localhost:4200)
 *   --user= --password=   account to sign in with (default: the seed's demo account)
 *   --out=<dir>           output directory (default tmp/screenshots)
 *   --www-dir=<dir>       also copy the composed images into <dir>/public/screenshots
 *   --only=<id,id>        take only these raw shots (see SHOTS) and skip composing
 *   --allow-remote        accept a non-local URL (see the note on local stacks below)
 *   --channel=<name>      browser channel (default chrome; e.g. msedge, chromium)
 *   --headed              show the browser window
 *   --list                print shot and image ids, then exit
 *
 * Output:
 *   <out>/<lang>/raw/<shot>.png        one screen each, device pixel ratio 2
 *   <out>/<lang>/raw/<shot>.FAILED.*   for a shot that failed: the screen as it
 *                                      was (.png) and a report (.txt): what the
 *                                      page logged, record counts in IndexedDB,
 *                                      and each API answer with its item counts
 *   <out>/www/<site path>.webp         composed images for reapps-www
 *   <out>/readme/<name>.webp           the two README images (--lang=en only)
 *
 * The seed fills the database in ONE language, so each run covers one
 * language. The script checks that the seeded titles are on screen and stops
 * with a clear message when the database holds the other language.
 *
 * Only a local stack is accepted by default: the demo account and its public
 * password exist only where the seed ran, and the seed wipes the database it
 * points at, so it never runs against production. `--allow-remote` with
 * `--user` / `--password` is for a demo account created by hand elsewhere
 * (five wrong passwords lock that account for 15 minutes).
 *
 * Guideline: reapps-docs/guidelines/84-screenshots.md
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const args = parseArgs(process.argv.slice(2));
const LANGS = ['en', 'pl'];
const lang = typeof args.lang === 'string' ? args.lang : 'en';
if (!LANGS.includes(lang)) fail(`--lang must be one of: ${LANGS.join(', ')}`);

const base = String(args.base ?? 'http://localhost').replace(/\/+$/, '');
const notesUrl = String(args['notes-url'] ?? `${base}/notes`).replace(/\/+$/, '');
const taskUrl = String(args['task-url'] ?? `${base}/task`).replace(/\/+$/, '');
const username = String(args.user ?? 'demo');
const password = String(args.password ?? 'Demo1234!');
const outDir = resolve(ROOT, String(args.out ?? 'tmp/screenshots'));
const wwwDir = typeof args['www-dir'] === 'string' ? resolve(ROOT, args['www-dir']) : null;
const only = typeof args.only === 'string' ? args.only.split(',').filter(Boolean) : null;
const channel = String(args.channel ?? 'chrome');

function fail(message) {
  console.error(`capture-screenshots: ${message}`);
  process.exit(1);
}

function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- seed content

/**
 * Titles the shots click on. They come from `packages/database/src/seed-data.ts`
 * (a TypeScript file this script cannot import) - keep the two in step.
 */
const TITLES = {
  noteArticle: {
    en: 'Why Zero Knowledge encryption matters',
    pl: 'Dlaczego szyfrowanie Zero Knowledge ma znaczenie'
  },
  noteTrip: { en: 'Lisbon trip plan', pl: 'Plan podróży - Lizbona' },
  task: { en: 'Prepare quarterly presentation', pl: 'Przygotować prezentację kwartalną' }
};

// ------------------------------------------------------------------- labels

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

/** UI labels in the chosen language, read from the app's own catalogs. */
function loadLabels(locale) {
  const notes = readJson(`packages/i18n/src/translations/notes/${locale}.json`);
  const taskSync = readJson(`packages/i18n/src/translations/tasks/${locale}/sync.json`);
  const task = readJson(`packages/i18n/src/translations/tasks/${locale}/task.json`);
  const labels = {
    allNotes: notes.nav?.all_notes,
    folders: notes.nav?.folders,
    tags: notes.nav?.tags,
    split: notes.view_mode?.split,
    notesSynced: notes.sync_status?.synced,
    taskSynced: taskSync.indicator?.synced,
    taskDescription: task.fields?.description,
    taskNotFound: task.errors?.not_found
  };
  for (const [name, value] of Object.entries(labels)) {
    if (typeof value !== 'string' || value.length === 0) {
      fail(`label "${name}" not found in the ${locale} catalogs - a key was renamed`);
    }
  }
  return labels;
}

// -------------------------------------------------------------------- shots

// A 390 x 844 phone, less the 44 px status bar that composing draws on top.
const PHONE = { width: 390, height: 800 };
const DESKTOP = { width: 1428, height: 1068 };

/**
 * Raw screens. `app` picks the root URL, `view` the viewport, `theme` the
 * color scheme (the seeded account keeps the default "System" theme, so the
 * app follows the emulated scheme). `go` brings a freshly loaded app to the
 * state to capture.
 */
const SHOTS = [
  { id: 'notes-list-light', app: 'notes', view: 'phone', theme: 'light', go: notesList },
  { id: 'notes-list-dark', app: 'notes', view: 'phone', theme: 'dark', go: notesList },
  {
    id: 'notes-article-light',
    app: 'notes',
    view: 'phone',
    theme: 'light',
    go: openNote('noteArticle')
  },
  { id: 'notes-trip-light', app: 'notes', view: 'phone', theme: 'light', go: openNote('noteTrip') },
  { id: 'notes-trip-dark', app: 'notes', view: 'phone', theme: 'dark', go: openNote('noteTrip') },
  {
    id: 'notes-folders-light',
    app: 'notes',
    view: 'phone',
    theme: 'light',
    go: notesSection('folders')
  },
  { id: 'notes-tags-light', app: 'notes', view: 'phone', theme: 'light', go: notesSection('tags') },
  { id: 'notes-desktop-light', app: 'notes', view: 'desktop', theme: 'light', go: notesDesktop },
  { id: 'task-list-light', app: 'task', view: 'phone', theme: 'light', go: taskList },
  { id: 'task-list-dark', app: 'task', view: 'phone', theme: 'dark', go: taskList },
  { id: 'task-detail-light', app: 'task', view: 'phone', theme: 'light', go: taskDetail },
  { id: 'task-detail-dark', app: 'task', view: 'phone', theme: 'dark', go: taskDetail },
  { id: 'task-desktop-light', app: 'task', view: 'desktop', theme: 'light', go: taskDetail }
];

/**
 * Composed images, named as the site names them. `pair` puts two phone
 * screens side by side; `single` centres one desktop screen.
 */
function images(locale) {
  return [
    { path: `hero/hero-${locale}-1-notes-task`, pair: ['notes-list-light', 'task-list-light'] },
    { path: `hero/hero-${locale}-2-notes-ww`, pair: ['notes-list-light', 'notes-article-light'] },
    { path: `hero/hero-${locale}-3-task-wb`, pair: ['task-list-light', 'task-detail-dark'] },
    { path: `hero/hero-${locale}-4-notes-tablet`, single: 'notes-desktop-light' },
    {
      path: `renotes/renotes-1-${locale}-notes-ww`,
      pair: ['notes-list-light', 'notes-trip-light']
    },
    { path: `renotes/renotes-2-${locale}-notes-bb`, pair: ['notes-list-dark', 'notes-trip-dark'] },
    {
      path: `renotes/renotes-3-${locale}-folders-tags`,
      pair: ['notes-folders-light', 'notes-tags-light']
    },
    { path: `renotes/renotes-4-${locale}-tablet`, single: 'notes-desktop-light' },
    { path: `retask/retask-1-${locale}-task-ww`, pair: ['task-list-light', 'task-detail-light'] },
    { path: `retask/retask-2-${locale}-task-bb`, pair: ['task-list-dark', 'task-detail-dark'] },
    { path: `retask/retask-3-${locale}-tablet`, single: 'task-desktop-light' }
  ];
}

/** README images (English only): a copy of two site images under other names. */
const README_IMAGES = [
  { from: 'renotes/renotes-1-en-notes-ww', to: 'renotes-screenshot' },
  { from: 'retask/retask-1-en-task-ww', to: 'retask-screenshot' }
];

if (args.list) {
  console.log('Raw shots:');
  for (const shot of SHOTS) console.log(`  ${shot.id}`);
  console.log('Composed images:');
  for (const image of images(lang)) console.log(`  ${image.path}.webp`);
  process.exit(0);
}

if (only) {
  const known = new Set(SHOTS.map((shot) => shot.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) fail(`unknown shot id: ${unknown.join(', ')} (see --list)`);
}

// ------------------------------------------------------------ page helpers

/** For waits and cosmetic steps whose failure changes nothing. */
function ignore() {
  return undefined;
}

/** First visible element with exactly this text. */
function byText(page, text) {
  return page.getByText(text, { exact: true }).filter({ visible: true }).first();
}

/** First visible button with exactly this accessible name. */
function byButton(page, name) {
  return page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
}

/**
 * Let fonts, images and the last layout pass finish before the screen is
 * taken. The pointer is parked in a corner first: left where the last click
 * was, it keeps a tooltip open over the content and a list row highlighted.
 */
async function settle(page) {
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(viewport.width - 1, 1).catch(ignore);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(ignore);
  await page.evaluate(() => document.fonts.ready).catch(ignore);
  await page.waitForTimeout(700);
}

/**
 * Sign in when the app asks for it. `readyText` is seeded content and
 * `syncedText` the "Synced" label of the app: either one on screen means the
 * app is past the sign-in form, with or without data.
 */
async function signInIfAsked(page, readyText, syncedText) {
  const form = page.locator('#username');
  // Whichever shows first decides. Each wait swallows its own timeout: the
  // losers of the race keep waiting in the background and must not reject.
  const shows = (locator) => locator.waitFor({ state: 'visible', timeout: 30_000 }).catch(ignore);
  await Promise.race([
    shows(form),
    shows(byText(page, readyText)),
    shows(byText(page, syncedText))
  ]);
  if (!(await form.isVisible().catch(() => false))) return;
  await form.fill(username);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').filter({ visible: true }).first().click();
}

/**
 * The app is up, but the seeded content is not on screen. The other shots of
 * the same app would wait for the same thing, so the run skips them.
 */
class SeedMissingError extends Error {}

/** How long the seeded content may take to show, from the page load on. */
const SEED_TIMEOUT = 45_000;
/** ...and once the app says "Synced": by then the data is on screen or is not coming. */
const SEED_TIMEOUT_SYNCED = 10_000;

/**
 * Wait for seeded content. It gives up early when the app reports "Synced"
 * and still shows nothing. When the content does not come, say why if the
 * reason is the usual one: the database was seeded in the other language.
 */
async function waitForSeed(page, key, syncedText) {
  const expected = TITLES[key][lang];
  const title = byText(page, expected);
  const synced = byText(page, syncedText);
  const started = Date.now();
  let syncedAt = null;
  while (Date.now() - started < SEED_TIMEOUT) {
    if (await title.isVisible().catch(() => false)) return;
    if (await synced.isVisible().catch(() => false)) {
      syncedAt ??= Date.now();
      if (Date.now() - syncedAt > SEED_TIMEOUT_SYNCED) break;
    } else {
      syncedAt = null;
    }
    await page.waitForTimeout(250);
  }
  const other = LANGS.find((l) => l !== lang);
  const otherVisible = await byText(page, TITLES[key][other])
    .isVisible()
    .catch(() => false);
  if (otherVisible) {
    throw new SeedMissingError(
      `the database is seeded in "${other}", not "${lang}" - run: pnpm db:seed -- --lang ${lang}`
    );
  }
  if (
    await page
      .locator('#username')
      .isVisible()
      .catch(() => false)
  ) {
    throw new SeedMissingError(
      `still on the sign-in form - wrong account or password, or the account is locked`
    );
  }
  throw new SeedMissingError(
    syncedAt === null
      ? `"${expected}" did not appear - is the stack running and seeded?`
      : `the app is signed in and says "${syncedText}", but "${expected}" is not there - see the .FAILED.txt for what the server sent`
  );
}

/**
 * For the failure report: how many records each IndexedDB store holds, and
 * the names (never the values) of what the page keeps in web storage.
 */
function describeBrowserData(page) {
  return page.evaluate(async () => {
    const lines = [];
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise((done, failed) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => done(request.result);
        request.onerror = () => failed(request.error);
      });
      const counts = [];
      for (const store of db.objectStoreNames) {
        const count = await new Promise((done) => {
          try {
            const request = db.transaction(store).objectStore(store).count();
            request.onsuccess = () => done(request.result);
            request.onerror = () => done('?');
          } catch {
            done('?');
          }
        });
        counts.push(`${store} ${count}`);
      }
      db.close();
      lines.push(`IndexedDB ${name}: ${counts.join(', ') || '(no stores)'}`);
    }
    lines.push(`localStorage keys: ${Object.keys(localStorage).sort().join(', ') || '(none)'}`);
    lines.push(`sessionStorage keys: ${Object.keys(sessionStorage).sort().join(', ') || '(none)'}`);
    return lines;
  });
}

/**
 * One line per API answer, for the failure report: status, address, size and
 * how many items each list in the answer holds. Counts only, no content.
 */
async function describeApiResponse(response) {
  const request = response.request();
  const url = new URL(response.url());
  let shape = '';
  try {
    const body = await response.body();
    shape = `${body.length} bytes`;
    const data = JSON.parse(body.toString('utf8'));
    const lists = Array.isArray(data)
      ? [`${data.length} items`]
      : Object.entries(data ?? {})
          .filter(([, value]) => Array.isArray(value))
          .map(([name, value]) => `${name}: ${value.length}`);
    if (lists.length > 0) shape += `, ${lists.join(', ')}`;
  } catch {
    /* no body, or not JSON: the size (if any) is all there is to say */
  }
  return `[api ${response.status()}] ${request.method()} ${url.pathname}${url.search} ${shape}`.trimEnd();
}

// ------------------------------------------------------------------ states

async function notesList(page, ctx) {
  await page.goto(ctx.notesUrl, { waitUntil: 'domcontentloaded' });
  await signInIfAsked(page, TITLES.noteTrip[lang], ctx.labels.notesSynced);
  await waitForSeed(page, 'noteTrip', ctx.labels.notesSynced);
  await byText(page, ctx.labels.notesSynced)
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(ignore);
}

function openNote(key) {
  return async (page, ctx) => {
    await notesList(page, ctx);
    await byText(page, TITLES[key][lang]).click();
    await page.waitForTimeout(800);
  };
}

function notesSection(section) {
  return async (page, ctx) => {
    await notesList(page, ctx);
    await byButton(page, ctx.labels[section]).click();
    await page.waitForTimeout(500);
  };
}

async function notesDesktop(page, ctx) {
  await notesList(page, ctx);
  await byText(page, TITLES.noteArticle[lang]).click();
  await page.waitForTimeout(800);
  // Split view shows the Markdown source next to the rendered note. The
  // button is absent on narrow layouts - then the default view stays.
  const split = byButton(page, ctx.labels.split);
  if (await split.isVisible().catch(() => false)) {
    await split.click();
    await page.waitForTimeout(500);
  }
}

async function taskList(page, ctx) {
  await page.goto(`${ctx.taskUrl}/all`, { waitUntil: 'domcontentloaded' });
  await signInIfAsked(page, TITLES.task[lang], ctx.labels.taskSynced);
  await waitForSeed(page, 'task', ctx.labels.taskSynced);
  await byText(page, ctx.labels.taskSynced)
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(ignore);
}

/**
 * What the task detail showed in the first moments after the click, as a list
 * of changes ("120 ms: loading"). Runs inside the page, so it starts counting
 * before the next step of the script can look.
 */
function watchTaskDetail(page, labels, duration) {
  return page.evaluate(
    async ({ loadedText, missingText, duration: total }) => {
      const read = () => {
        const text = document.body.innerText;
        if (text.includes(loadedText)) return 'loaded';
        if (text.includes(missingText)) return 'not found';
        if (document.querySelector('[data-slot="skeleton"], .animate-pulse')) return 'loading';
        return 'other';
      };
      const seen = [];
      const started = performance.now();
      let last = null;
      while (performance.now() - started < total) {
        const now = read();
        if (now !== last) {
          seen.push(`${Math.round(performance.now() - started)} ms: ${now}`);
          last = now;
        }
        await new Promise((done) => setTimeout(done, 40));
      }
      return seen;
    },
    { loadedText: labels.taskDescription, missingText: labels.taskNotFound, duration }
  );
}

/** Which IndexedDB stores hold a record with this key ("database/store"). */
function findInIndexedDb(page, id) {
  return page.evaluate(async (key) => {
    const found = [];
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise((done, failed) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => done(request.result);
        request.onerror = () => failed(request.error);
      });
      for (const store of db.objectStoreNames) {
        const has = await new Promise((done) => {
          try {
            const request = db.transaction(store).objectStore(store).get(key);
            request.onsuccess = () => done(request.result !== undefined);
            request.onerror = () => done(false);
          } catch {
            done(false);
          }
        });
        if (has) found.push(`${name}/${store}`);
      }
      db.close();
    }
    return found;
  }, id);
}

/**
 * Open the seeded task from the list. The first try waits a moment before the
 * click, as a person would; a second try waits longer. A click that comes
 * right after the app starts can leave the detail on "Task not found" for
 * good, with nothing in the console.
 */
async function taskDetail(page, ctx) {
  const loaded = byText(page, ctx.labels.taskDescription);
  const pauses = [1500, 5000];
  for (const [attempt, pause] of pauses.entries()) {
    await taskList(page, ctx);
    await page.waitForTimeout(pause);
    await byText(page, TITLES.task[lang]).click();
    const timeline = await watchTaskDetail(page, ctx.labels, 3000).catch(() => []);
    const seen = timeline.join(', ') || '(nothing recorded)';
    // The "Description" heading is only there once the task is loaded and
    // decrypted.
    const ok = await loaded
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      if (attempt > 0) {
        ctx.warn(
          `the task opened only on try ${attempt + 1} (${pause} ms after the list was ready)`
        );
      }
      await page.waitForTimeout(500);
      return;
    }
    const id = new URL(page.url()).pathname.split('/').pop() ?? '';
    const stores = await findInIndexedDb(page, id).catch(() => ['(could not read IndexedDB)']);
    ctx.note(`try ${attempt + 1}, click ${pause} ms after the list was ready: ${seen}`);
    ctx.note(`  address ${page.url()}`);
    ctx.note(`  task in IndexedDB: ${stores.join(', ') || 'not in any store'}`);
  }
  throw new Error(`the task detail did not load in ${pauses.length} tries (${page.url()})`);
}

// ---------------------------------------------------------------- composing

function dataUrl(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

/**
 * Brand color of the status bar on a phone, per app: the `theme-color` of
 * each app (app.html). The installed web app and the native shell paint the
 * system status bar with it in the light and in the dark theme alike.
 */
const STATUS_BAR_COLOR = { notes: '#FFD43B', task: '#43a047' };

/** Signal, Wi-Fi and battery, drawn dark as the apps ask the system to. */
const STATUS_ICONS = `<svg width="69" height="13" viewBox="0 0 69 13" fill="currentColor">
  <rect x="0" y="8.4" width="3.1" height="4.6" rx="0.9"/>
  <rect x="4.8" y="5.8" width="3.1" height="7.2" rx="0.9"/>
  <rect x="9.6" y="3" width="3.1" height="10" rx="0.9"/>
  <rect x="14.4" y="0.2" width="3.1" height="12.8" rx="0.9"/>
  <path d="M30.6 2.3c2.7 0 5.2 1 7.1 2.8.2.2.4.2.6 0l.9-.9c.2-.2.2-.5 0-.7C36.9 1.3 33.9.1 30.6.1s-6.3 1.2-8.6 3.4c-.2.2-.2.5 0 .7l.9.9c.2.2.4.2.6 0 1.9-1.8 4.4-2.8 7.1-2.8z"/>
  <path d="M30.6 6.4c1.6 0 3.1.6 4.2 1.6.2.2.5.2.6 0l.9-.9c.2-.2.2-.5 0-.7-1.5-1.4-3.5-2.2-5.7-2.2s-4.2.8-5.7 2.2c-.2.2-.2.5 0 .7l.9.9c.2.2.5.2.6 0 1.1-1 2.6-1.6 4.2-1.6z"/>
  <path d="M33.5 9.9c.2-.2.2-.5 0-.7-.8-.7-1.8-1.1-2.9-1.1s-2.1.4-2.9 1.1c-.2.2-.2.5 0 .7l2.5 2.5c.2.2.6.2.8 0l2.5-2.5z"/>
  <rect x="44" y="0.7" width="21.6" height="11.6" rx="3.4" fill="none" stroke="currentColor" stroke-opacity="0.4"/>
  <rect x="45.6" y="2.3" width="18.4" height="8.4" rx="2"/>
  <path d="M66.9 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill-opacity="0.45"/>
</svg>`;

const FRAME_CSS = `
  html, body { margin: 0; background: #fff; }
  body { position: relative; overflow: hidden; }
  .frame {
    position: absolute; overflow: hidden;
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  .frame img { display: block; width: 100%; }
  .bar {
    box-sizing: border-box; height: 41px; padding: 0 30px 0 31px;
    display: flex; align-items: center; justify-content: space-between;
    color: #111;
    font: 600 16px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    letter-spacing: -0.2px;
  }
`;

/**
 * Canvas sizes match the images the site already ships, so the carousels
 * keep their proportions. Phone pair: 1764 x 1696 px, drawn at device pixel
 * ratio 2; each phone is the status bar in the color of its app (drawn here:
 * a browser screen has none) over the raw screen. Desktop: 1500 x 1373 px at
 * ratio 1, no bar.
 */
function phoneHtml(phone, left) {
  return `<div class="frame" style="left: ${left}px; top: 21px; width: 360px">
    <div class="bar" style="background: ${phone.barColor}"><span>9:41</span>${STATUS_ICONS}</div>
    <img src="${phone.src}">
  </div>`;
}

function pairHtml(left, right) {
  return `<!doctype html><style>${FRAME_CSS}
    body { width: 882px; height: 848px; }
  </style>
  ${phoneHtml(left, 35)}
  ${phoneHtml(right, 487)}`;
}

function singleHtml(src) {
  return `<!doctype html><style>${FRAME_CSS}
    body { width: 1500px; height: 1373px; }
  </style>
  <div class="frame" style="left: 36px; top: 138px; width: 1428px"><img src="${src}"></div>`;
}

async function compose(browser, sharp, rawDir, image, target) {
  const sources = image.pair ?? [image.single];
  const missing = sources.filter((id) => !existsSync(join(rawDir, `${id}.png`)));
  if (missing.length > 0) {
    console.warn(`  skipped ${image.path}: missing ${missing.join(', ')}`);
    return false;
  }
  const screens = sources.map((id) => ({
    src: dataUrl(join(rawDir, `${id}.png`)),
    barColor: STATUS_BAR_COLOR[SHOTS.find((shot) => shot.id === id)?.app] ?? '#000'
  }));
  const pair = Boolean(image.pair);
  const context = await browser.newContext({
    viewport: pair ? { width: 882, height: 848 } : { width: 1500, height: 1373 },
    deviceScaleFactor: pair ? 2 : 1
  });
  try {
    const page = await context.newPage();
    await page.setContent(pair ? pairHtml(screens[0], screens[1]) : singleHtml(screens[0].src));
    // This function runs inside the page, so it cannot use helpers from this
    // file. A picture that fails to decode shows up in the result anyway.
    await page.evaluate(() =>
      Promise.all(Array.from(document.images, (img) => img.decode().catch(() => undefined)))
    );
    const png = await page.screenshot({ type: 'png' });
    mkdirSync(dirname(target), { recursive: true });
    await sharp(png).webp({ quality: 88 }).toFile(target);
    return true;
  } finally {
    await context.close();
  }
}

// --------------------------------------------------------------------- main

async function main() {
  if (!args['allow-remote'] && (!isLocalUrl(notesUrl) || !isLocalUrl(taskUrl))) {
    fail(
      'only a local stack is accepted (localhost / 127.0.0.1). The demo account is for seeded local data.'
    );
  }

  let chromium;
  let sharp;
  try {
    ({ chromium } = await import('playwright-core'));
    sharp = (await import('sharp')).default;
  } catch (error) {
    fail(
      `a dependency is not installed (${error instanceof Error ? error.message : error}). Run: pnpm install`
    );
  }

  const labels = loadLabels(lang);
  const ctx = { notesUrl, taskUrl, labels };
  const rawDir = join(outDir, lang, 'raw');
  mkdirSync(rawDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({
      channel,
      headless: !args.headed,
      args: ['--hide-scrollbars']
    });
  } catch (error) {
    fail(
      `could not start the "${channel}" browser (${error instanceof Error ? error.message.split('\n')[0] : error}). Is Google Chrome installed? Try --channel=msedge or --channel=chromium.`
    );
  }

  const shots = only ? SHOTS.filter((shot) => only.includes(shot.id)) : SHOTS;
  const failed = [];
  const warnings = [];

  // One context for all raw shots: one sign-in, and the key the app keeps in
  // IndexedDB carries over between shots. Service workers are blocked so a
  // cached shell from an earlier build cannot be served.
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    locale: lang === 'pl' ? 'pl-PL' : 'en-US',
    colorScheme: 'light',
    serviceWorkers: 'block'
  });
  // The apps take the UI language from this key when the account has no
  // synced choice yet (app-settings.store.ts in both apps).
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem('preferred_language', value);
    } catch {
      /* storage unavailable: the browser locale decides */
    }
  }, lang);

  const page = await context.newPage();
  // What the page reported while a shot was being set up. Written next to the
  // picture when the shot fails: the reason is usually in there.
  let pageLog = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      pageLog.push(`[console ${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => pageLog.push(`[page error] ${error.message}`));
  // For the steps of a shot: a line for the failure report, and a warning for
  // a shot that was taken but not the straight way.
  let shotWarnings = [];
  ctx.note = (line) => pageLog.push(`[note] ${line}`);
  ctx.warn = (line) => shotWarnings.push(line);
  page.on('requestfailed', (request) =>
    pageLog.push(
      `[request failed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`
    )
  );
  // Every API answer of the shot, summarized. Reading a body takes a moment,
  // so the lines are promises, awaited when a report is written.
  let apiLog = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      pageLog.push(`[http ${response.status()}] ${response.request().method()} ${response.url()}`);
    }
    if (response.url().includes('/api/')) apiLog.push(describeApiResponse(response));
  });
  // App whose seeded content did not show, and the shot that found out.
  const noSeed = new Map();
  try {
    for (const shot of shots) {
      const file = join(rawDir, `${shot.id}.png`);
      process.stdout.write(`  ${shot.id} ... `);
      pageLog = [];
      shotWarnings = [];
      apiLog = [];
      rmSync(join(rawDir, `${shot.id}.FAILED.png`), { force: true });
      rmSync(join(rawDir, `${shot.id}.FAILED.txt`), { force: true });
      if (noSeed.has(shot.app)) {
        console.log(`skipped: re/${shot.app} had no seeded content in ${noSeed.get(shot.app)}`);
        failed.push(shot.id);
        rmSync(file, { force: true });
        continue;
      }
      try {
        await page.setViewportSize(shot.view === 'desktop' ? DESKTOP : PHONE);
        await page.emulateMedia({ colorScheme: shot.theme });
        await shot.go(page, ctx);
        await settle(page);
        await page.screenshot({ path: file, type: 'png' });
        console.log(shotWarnings.length > 0 ? 'ok, with a warning' : 'ok');
        for (const line of shotWarnings) {
          console.log(`    warning: ${line}`);
          warnings.push({ shot: shot.id, warning: line });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        console.log(`FAILED: ${message}`);
        failed.push(shot.id);
        if (error instanceof SeedMissingError) noSeed.set(shot.app, shot.id);
        // What the browser showed when it went wrong, for the fix.
        await page
          .screenshot({ path: join(rawDir, `${shot.id}.FAILED.png`), type: 'png' })
          .catch(ignore);
        const browserData = await describeBrowserData(page).catch(() => [
          '(could not read the browser storage)'
        ]);
        // An answer that is still streaming never finishes: do not wait for it.
        const late = new Promise((done) => setTimeout(done, 3000, '[api] (answer still open)'));
        const apiLines = await Promise.all(
          apiLog.map((line) =>
            Promise.race([line.catch(() => '[api] (answer could not be read)'), late])
          )
        );
        writeFileSync(
          join(rawDir, `${shot.id}.FAILED.txt`),
          `${[
            `error: ${message}`,
            `url: ${page.url()}`,
            '',
            ...pageLog,
            '',
            ...browserData,
            '',
            `API answers during this shot (${apiLines.length}):`,
            ...apiLines
          ].join('\n')}\n`
        );
        // The picture of an earlier good run would be composed as if current.
        rmSync(file, { force: true });
      }
    }
  } finally {
    await context.close();
  }

  let composed = 0;
  if (!only) {
    console.log('Composing:');
    const siteDir = join(outDir, 'www');
    for (const image of images(lang)) {
      const target = join(siteDir, `${image.path}.webp`);
      if (await compose(browser, sharp, rawDir, image, target)) {
        composed += 1;
        console.log(`  ${image.path}.webp`);
        if (wwwDir) {
          const installed = join(wwwDir, 'public', 'screenshots', `${image.path}.webp`);
          mkdirSync(dirname(installed), { recursive: true });
          copyFileSync(target, installed);
        }
      }
    }
    if (lang === 'en') {
      for (const { from, to } of README_IMAGES) {
        const source = join(siteDir, `${from}.webp`);
        if (!existsSync(source)) continue;
        const target = join(outDir, 'readme', `${to}.webp`);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
        console.log(`  readme/${to}.webp`);
      }
    }
  }

  await browser.close();

  writeFileSync(
    join(outDir, lang, 'run.json'),
    `${JSON.stringify({ lang, notesUrl, taskUrl, shots: shots.map((s) => s.id), failed, warnings }, null, 2)}\n`
  );

  console.log(
    `\n${shots.length - failed.length}/${shots.length} raw shots, ${composed} composed images in ${outDir}`
  );
  if (wwwDir && !only) console.log(`Copied into ${join(wwwDir, 'public', 'screenshots')}`);
  if (failed.length > 0) {
    console.error(`Failed: ${failed.join(', ')} (see the *.FAILED.png and *.FAILED.txt files)`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
