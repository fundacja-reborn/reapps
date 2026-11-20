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
 *                                      was (.png) and what the page logged (.txt)
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

const PHONE = { width: 390, height: 844 };
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

async function signInIfAsked(page, readyText) {
  const form = page.locator('#username');
  const ready = byText(page, readyText);
  // Whichever shows first decides. Each wait swallows its own timeout: the
  // loser of the race keeps waiting in the background and must not reject.
  await Promise.race([
    form.waitFor({ state: 'visible', timeout: 60_000 }).catch(ignore),
    ready.waitFor({ state: 'visible', timeout: 60_000 }).catch(ignore)
  ]);
  if (!(await form.isVisible().catch(() => false))) return;
  await form.fill(username);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').filter({ visible: true }).first().click();
}

/**
 * Wait for seeded content. When it does not come, say why if the reason is
 * the usual one: the database was seeded in the other language.
 */
async function waitForSeed(page, key) {
  const expected = TITLES[key][lang];
  try {
    await byText(page, expected).waitFor({ state: 'visible', timeout: 90_000 });
  } catch {
    const other = LANGS.find((l) => l !== lang);
    const otherVisible = await byText(page, TITLES[key][other])
      .isVisible()
      .catch(() => false);
    if (otherVisible) {
      throw new Error(
        `the database is seeded in "${other}", not "${lang}" - run: pnpm db:seed -- --lang ${lang}`
      );
    }
    throw new Error(`"${expected}" did not appear - is the stack running and seeded?`);
  }
}

// ------------------------------------------------------------------ states

async function notesList(page, ctx) {
  await page.goto(ctx.notesUrl, { waitUntil: 'domcontentloaded' });
  await signInIfAsked(page, TITLES.noteTrip[lang]);
  await waitForSeed(page, 'noteTrip');
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
  await signInIfAsked(page, TITLES.task[lang]);
  await waitForSeed(page, 'task');
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

const FRAME_CSS = `
  html, body { margin: 0; background: #fff; }
  body { position: relative; overflow: hidden; }
  img {
    position: absolute; display: block;
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.1);
  }
`;

/**
 * Canvas sizes match the images the site already ships, so the carousels
 * keep their proportions. Phone pair: 1764 x 1696 px, drawn at device pixel
 * ratio 2. Desktop: 1500 x 1373 px at ratio 1.
 */
function pairHtml(left, right) {
  return `<!doctype html><style>${FRAME_CSS}
    body { width: 882px; height: 848px; }
    img { width: 360px; top: 21px; }
  </style>
  <img style="left: 35px" src="${left}">
  <img style="left: 487px" src="${right}">`;
}

function singleHtml(src) {
  return `<!doctype html><style>${FRAME_CSS}
    body { width: 1500px; height: 1373px; }
    img { width: 1428px; left: 36px; top: 138px; }
  </style>
  <img src="${src}">`;
}

async function compose(browser, sharp, rawDir, image, target) {
  const sources = image.pair ?? [image.single];
  const missing = sources.filter((id) => !existsSync(join(rawDir, `${id}.png`)));
  if (missing.length > 0) {
    console.warn(`  skipped ${image.path}: missing ${missing.join(', ')}`);
    return false;
  }
  const urls = sources.map((id) => dataUrl(join(rawDir, `${id}.png`)));
  const pair = Boolean(image.pair);
  const context = await browser.newContext({
    viewport: pair ? { width: 882, height: 848 } : { width: 1500, height: 1373 },
    deviceScaleFactor: pair ? 2 : 1
  });
  try {
    const page = await context.newPage();
    await page.setContent(pair ? pairHtml(urls[0], urls[1]) : singleHtml(urls[0]));
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
  page.on('response', (response) => {
    if (response.status() >= 400) {
      pageLog.push(`[http ${response.status()}] ${response.request().method()} ${response.url()}`);
    }
  });
  try {
    for (const shot of shots) {
      const file = join(rawDir, `${shot.id}.png`);
      process.stdout.write(`  ${shot.id} ... `);
      pageLog = [];
      shotWarnings = [];
      rmSync(join(rawDir, `${shot.id}.FAILED.png`), { force: true });
      rmSync(join(rawDir, `${shot.id}.FAILED.txt`), { force: true });
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
        // What the browser showed when it went wrong, for the fix.
        await page
          .screenshot({ path: join(rawDir, `${shot.id}.FAILED.png`), type: 'png' })
          .catch(ignore);
        writeFileSync(
          join(rawDir, `${shot.id}.FAILED.txt`),
          `${[`error: ${message}`, `url: ${page.url()}`, '', ...pageLog].join('\n')}\n`
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
