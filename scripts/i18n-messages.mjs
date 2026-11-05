/**
 * Translation catalogs and message validation, shared by check-i18n-parity,
 * i18n-export, i18n-import and the @reborn/i18n specs (icu-messages.spec.ts,
 * i18n-transfer.spec.ts).
 *
 * Messages are parsed with the same ICU MessageFormat parser svelte-i18n uses
 * at runtime (via intl-messageformat), with the same `ignoreTag: true`, so a
 * message that fails here would fail - or silently lose a placeholder - in the
 * app. The classic trap: an apostrophe right before a brace starts a quoted
 * literal, so French `l'{name}` renders as the text "l{name}" and `'{name}'`
 * as "{name}" (both caught as `quoted-placeholder`, English included).
 *
 * Two validation levels:
 * - `catalog` (CI, every shipped locale): the message parses, no placeholder
 *   is quoted into text, it uses the same arguments as English with the same
 *   kind (plain / plural / select ...), its select options match English, its
 *   plural categories exist in the locale's CLDR rules, and it has no
 *   bidi-override or invisible characters.
 * - `import` (a translator's file): all of the above, plus every CLDR plural
 *   category of the locale, no URLs / e-mails / domains / tags that English
 *   does not have, Western digits only, no em-dash (project rule). Numbers
 *   missing from English are a warning.
 *
 * Messages are strings, except a few lists of plain strings (read with
 * `$json`, not formatted), which are checked item by item.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import icuParser from '@formatjs/icu-messageformat-parser';

const { parse, TYPE } = icuParser;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_SRC = join(REPO_ROOT, 'packages', 'i18n', 'src');
const TRANSLATIONS_DIR = join(I18N_SRC, 'translations');
const RELEASE_NOTES_TEXT_DIR = join(I18N_SRC, 'release-notes', 'text');

export const SOURCE_LOCALE = 'en';

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/**
 * Every translation file group, as `{ id, syntax, path(locale), runtimeKey(key) }`.
 * `runtimeKey` is the key code passes to `$t()` (null for release notes, which
 * are not rendered through svelte-i18n).
 */
export function listCatalogs() {
  const flat = (id) => ({
    id,
    syntax: 'icu',
    path: (locale) => join(TRANSLATIONS_DIR, id, `${locale}.json`),
    runtimeKey: (key) => key
  });
  // tasks: one folder per locale, one file per namespace. setup.ts mounts each
  // file under its name, except app.json (`title` -> `appTitle`).
  const tasks = readdirSync(join(TRANSLATIONS_DIR, 'tasks', SOURCE_LOCALE))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const ns = file.replace(/\.json$/, '');
      return {
        id: `tasks/${ns}`,
        syntax: 'icu',
        path: (locale) => join(TRANSLATIONS_DIR, 'tasks', locale, file),
        runtimeKey: (key) => (ns === 'app' && key === 'title' ? 'appTitle' : `${ns}.${key}`)
      };
    });
  const releaseNotes = {
    id: 'release-notes',
    syntax: 'plain',
    path: (locale) => join(RELEASE_NOTES_TEXT_DIR, `${locale}.json`),
    runtimeKey: () => null
  };
  return [flat('notes'), flat('common'), ...tasks, releaseNotes];
}

/** Flatten a nested translation object into an ordered Map of dotted key -> string. */
export function flattenMessages(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenMessages(v, key, out);
    else out.set(key, v);
  }
  return out;
}

/** Messages of one catalog in one locale, or null when the file does not exist. */
export function readCatalog(catalog, locale) {
  const path = catalog.path(locale);
  if (!existsSync(path)) return null;
  return flattenMessages(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Write `messages` as nested JSON in the key order of `order` (English), so a
 * re-import produces a minimal diff. Keys absent from `messages` are skipped.
 */
export function serializeCatalog(messages, order) {
  const root = {};
  for (const key of order.keys()) {
    if (!messages.has(key)) continue;
    const parts = key.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = messages.get(key);
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}

/**
 * Source spans of every leaf value (string, list, number ...) in a JSON text,
 * by dotted key. Lets a change replace only the value it touches.
 */
export function locateLeaves(text) {
  const spans = new Map();
  let i = 0;
  const skipSpace = () => {
    while (i < text.length && /\s/u.test(text[i])) i++;
  };
  const skipString = () => {
    i++; // opening quote
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
  };
  const skipArray = () => {
    let depth = 0;
    do {
      if (text[i] === '"') {
        skipString();
        continue;
      }
      if (text[i] === '[') depth++;
      if (text[i] === ']') depth--;
      i++;
    } while (depth > 0);
  };
  const value = (path) => {
    skipSpace();
    if (text[i] === '{') {
      i++;
      skipSpace();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        skipSpace();
        const keyStart = i;
        skipString();
        const key = JSON.parse(text.slice(keyStart, i));
        skipSpace();
        i++; // colon
        value(path ? `${path}.${key}` : key);
        skipSpace();
        if (text[i++] === '}') return;
      }
    }
    const start = i;
    if (text[i] === '[') skipArray();
    else if (text[i] === '"') skipString();
    else while (i < text.length && !/[\s,}\]]/u.test(text[i])) i++;
    spans.set(path, { start, end: i });
  };
  value('');
  return spans;
}

/**
 * Replace the values of existing keys in a JSON text, leaving its formatting
 * (Prettier's one-line objects, escapes) untouched. Returns null when a key is
 * not in the text yet, so the caller can fall back to a full rewrite.
 */
export function patchCatalogText(text, changes) {
  const spans = locateLeaves(text);
  const edits = [];
  for (const [key, value] of changes) {
    const span = spans.get(key);
    if (!span) return null;
    edits.push({ ...span, replacement: JSON.stringify(value) });
  }
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}

/**
 * Apply `changes` (key -> value) to a locale file: a minimal in-place edit when
 * every key exists, otherwise a rewrite in English key order.
 */
export function writeCatalogChanges(catalog, locale, changes, order) {
  const path = catalog.path(locale);
  const text = readFileSync(path, 'utf8');
  const patched = patchCatalogText(text, changes);
  if (patched !== null) {
    writeFileSync(path, patched);
    return;
  }
  const messages = flattenMessages(JSON.parse(text));
  for (const [key, value] of changes) messages.set(key, value);
  writeFileSync(path, serializeCatalog(messages, order));
}

// ---------------------------------------------------------------------------
// Message analysis
// ---------------------------------------------------------------------------

const KIND = {
  [TYPE.argument]: 'value',
  [TYPE.number]: 'number',
  [TYPE.date]: 'date',
  [TYPE.time]: 'time',
  [TYPE.select]: 'select'
};

/**
 * Parse an ICU message. Returns `{ error }`, or `{ args, choices, literal }`:
 * - args: Map argument name -> kind (value | number | date | time | select |
 *   plural | selectordinal),
 * - choices: every select / plural with its option keys,
 * - literal: the message text without ICU syntax (for content checks).
 */
export function analyzeMessage(text) {
  let ast;
  try {
    ast = parse(text, { ignoreTag: true, requiresOtherClause: true });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const args = new Map();
  const choices = [];
  let literal = '';
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === TYPE.literal) {
        literal += node.value;
        continue;
      }
      if (node.type === TYPE.pound) continue;
      if (node.type === TYPE.tag) {
        walk(node.children);
        continue;
      }
      const kind =
        node.type === TYPE.plural
          ? node.pluralType === 'ordinal'
            ? 'selectordinal'
            : 'plural'
          : KIND[node.type];
      if (!args.has(node.value)) args.set(node.value, kind);
      literal += ' ';
      if (node.type === TYPE.plural || node.type === TYPE.select) {
        choices.push({ name: node.value, kind, options: Object.keys(node.options) });
        for (const option of Object.values(node.options)) walk(option.value);
      }
    }
  };
  walk(ast);
  return { args, choices, literal };
}

const CLDR_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * CLDR plural categories of a locale (cardinal for `plural`, ordinal for
 * `selectordinal`), in CLDR order. Older engines return them unsorted.
 */
export function pluralCategories(locale, kind = 'plural') {
  const type = kind === 'selectordinal' ? 'ordinal' : 'cardinal';
  return [...new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories].sort(
    (a, b) => CLDR_ORDER.indexOf(a) - CLDR_ORDER.indexOf(b)
  );
}

/** Placeholders of an English message, formatted for a translator (`{count}`). */
export function describeArguments(text) {
  const analysis = analyzeMessage(text);
  return analysis.error ? [] : [...analysis.args.keys()].map((name) => `{${name}}`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Bidi embeddings / overrides / isolates can reorder what the user reads (a
// spoofing vector in security texts); zero-width and other invisible characters
// hide content. The only direction marks allowed are LRM, RLM and ALM
// (U+200E, U+200F, U+061C), which translators legitimately need around
// Latin names in Arabic text.
const FORBIDDEN_CHARS = [
  [/[\u{202A}-\u{202E}]/u, 'bidi embedding or override character (U+202A-U+202E)'],
  [/[\u{2066}-\u{2069}]/u, 'bidi isolate character (U+2066-U+2069)'],
  [
    /[\u{200B}-\u{200D}\u{2060}\u{FEFF}\u{00AD}\u{180E}]/u,
    'invisible character (zero-width, BOM or soft hyphen)'
  ],
  [/[\u{2028}\u{2029}]/u, 'Unicode line or paragraph separator'],
  // eslint-disable-next-line no-control-regex -- finding control characters is the point
  [/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u, 'control character']
];

const URL_LIKE =
  /\bhttps?:\/\/[^\s"'<>«»]+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\b[\w-]+(?:\.[\w-]+)*\.(?:eu|com|org|net|io|app|dev|pl|de|fr|es)\b/giu;
const TAG_LIKE = /<\/?[A-Za-z][^<>]*>/gu;
const DIGITS = /\p{Nd}+/gu;
const EM_DASH = '\u{2014}';

// A placeholder that survived parsing as plain text: an apostrophe right before
// `{` starts ICU quoting, so `'{name}'` renders the characters "{name}".
const QUOTED_PLACEHOLDER = /\{\s*[A-Za-z_]\w*\s*(?:,[^{}]*)?\}/u;

const issue = (level, code, message) => ({ level, code, message });

function setDiff(a, b) {
  return [...a].filter((x) => !b.has(x));
}

/**
 * Problems of a message on its own, without comparing it to English: ICU
 * syntax and placeholders turned into text by quoting. Used for English
 * itself, which every other check takes as the reference.
 */
export function validateSource(text, syntax = 'icu') {
  if (syntax !== 'icu' || typeof text !== 'string') return [];
  const analysis = analyzeMessage(text);
  if (analysis.error) return [issue('error', 'icu-syntax', `ICU syntax error: ${analysis.error}`)];
  return quotedPlaceholderIssues(analysis);
}

function quotedPlaceholderIssues(analysis) {
  const match = analysis.literal.match(QUOTED_PLACEHOLDER);
  if (!match) return [];
  return [
    issue(
      'error',
      'quoted-placeholder',
      `"${match[0]}" is shown as text: an apostrophe before "{" starts ICU quoting; quote with "...", „...", «...» instead of '...'`
    )
  ];
}

/**
 * Validate one translated message against its English source. A message can
 * be an array of plain strings (lists read with `$json`), which is checked
 * element by element.
 * @param {{ en: string | string[], text: unknown, locale: string, syntax?: 'icu' | 'plain', mode?: 'catalog' | 'import' }} input
 * @returns {{ level: 'error' | 'warning', code: string, message: string }[]}
 */
export function validateMessage({ en, text, locale, syntax = 'icu', mode = 'catalog' }) {
  if (Array.isArray(en)) {
    if (!Array.isArray(text))
      return [issue('error', 'not-array', 'translation must be a list like the English one')];
    if (text.length !== en.length) {
      return [
        issue('error', 'array-length', `list has ${text.length} items, English has ${en.length}`)
      ];
    }
    return en.flatMap((item, i) =>
      validateMessage({ en: item, text: text[i], locale, syntax: 'plain', mode }).map((found) => ({
        ...found,
        message: `item ${i + 1}: ${found.message}`
      }))
    );
  }

  const issues = [];
  if (typeof text !== 'string')
    return [issue('error', 'not-string', 'translation is not a string')];
  if (mode === 'import' && text.trim() === '')
    return [issue('error', 'empty', 'translation is empty')];

  for (const [pattern, label] of FORBIDDEN_CHARS) {
    if (pattern.test(text)) issues.push(issue('error', 'forbidden-char', `contains a ${label}`));
  }

  let literal = text;
  let enLiteral = en;
  if (syntax === 'icu') {
    const source = analyzeMessage(en);
    const target = analyzeMessage(text);
    if (target.error)
      return [...issues, issue('error', 'icu-syntax', `ICU syntax error: ${target.error}`)];
    issues.push(...quotedPlaceholderIssues(target));
    if (!source.error) {
      issues.push(...compareStructure(source, target, locale, mode));
      literal = target.literal;
      enLiteral = source.literal;
    }
  }

  if (mode === 'import') issues.push(...compareContent(enLiteral, literal, en, text));
  return issues;
}

function compareStructure(source, target, locale, mode) {
  const issues = [];
  const sourceNames = new Set(source.args.keys());
  const targetNames = new Set(target.args.keys());
  for (const name of setDiff(sourceNames, targetNames)) {
    issues.push(issue('error', 'missing-arg', `placeholder {${name}} is missing`));
  }
  for (const name of setDiff(targetNames, sourceNames)) {
    issues.push(issue('error', 'extra-arg', `placeholder {${name}} does not exist in English`));
  }
  for (const [name, kind] of source.args) {
    const targetKind = target.args.get(name);
    if (targetKind && targetKind !== kind) {
      issues.push(
        issue('error', 'arg-kind', `{${name}} is ${targetKind} here but ${kind} in English`)
      );
    }
  }

  const sourceSelects = new Map();
  for (const choice of source.choices) {
    if (choice.kind !== 'select') continue;
    const set = sourceSelects.get(choice.name) ?? new Set();
    choice.options.forEach((o) => set.add(o));
    sourceSelects.set(choice.name, set);
  }

  for (const choice of target.choices) {
    const options = new Set(choice.options);
    if (choice.kind === 'select') {
      const expected = sourceSelects.get(choice.name);
      if (!expected) continue;
      const missing = setDiff(expected, options);
      const extra = setDiff(options, expected);
      if (missing.length)
        issues.push(
          issue('error', 'select-options', `{${choice.name}} select lacks: ${missing.join(', ')}`)
        );
      if (extra.length)
        issues.push(
          issue(
            'error',
            'select-options',
            `{${choice.name}} select has unknown options: ${extra.join(', ')}`
          )
        );
      continue;
    }
    const categories = pluralCategories(locale, choice.kind);
    const invalid = choice.options.filter((o) => !o.startsWith('=') && !categories.includes(o));
    if (invalid.length) {
      issues.push(
        issue(
          'error',
          'plural-category',
          `{${choice.name}} uses ${invalid.join(', ')}, not a ${locale} plural category (${categories.join(', ')})`
        )
      );
    }
    if (mode === 'import') {
      const missing = categories.filter((c) => !options.has(c));
      if (missing.length) {
        issues.push(
          issue(
            'error',
            'plural-incomplete',
            `{${choice.name}} needs every ${locale} form: missing ${missing.join(', ')}`
          )
        );
      }
    }
  }
  return issues;
}

function compareContent(enLiteral, literal, en, text) {
  const issues = [];
  const tokens = (pattern, value) =>
    new Set((value.match(pattern) ?? []).map((t) => t.toLowerCase()));

  const urls = setDiff(tokens(URL_LIKE, literal), tokens(URL_LIKE, enLiteral));
  if (urls.length)
    issues.push(
      issue('error', 'new-url', `link, e-mail or domain not in English: ${urls.join(', ')}`)
    );

  const tags = setDiff(tokens(TAG_LIKE, literal), tokens(TAG_LIKE, enLiteral));
  if (tags.length)
    issues.push(issue('error', 'new-tag', `markup not in English: ${tags.join(', ')}`));

  const digits = literal.match(DIGITS) ?? [];
  if (digits.some((d) => /[^0-9]/u.test(d))) {
    issues.push(issue('error', 'digits', 'uses non-Western digits; the app uses 0-9'));
  }
  const enDigits = new Set(enLiteral.match(DIGITS) ?? []);
  const newNumbers = [...new Set(digits.filter((d) => /^[0-9]+$/u.test(d) && !enDigits.has(d)))];
  // A warning, not an error: date-format examples and the like are localized
  // legitimately ("1 maja 2025"). A changed number in a security text ("6-digit
  // code") is caught by the back-translation of critical keys.
  if (newNumbers.length)
    issues.push(issue('warning', 'new-number', `number not in English: ${newNumbers.join(', ')}`));

  if (text.includes(EM_DASH))
    issues.push(issue('error', 'em-dash', 'contains an em-dash (U+2014); use " - "'));

  const edge = (s) => [/^\s/u.test(s), /\s$/u.test(s)].join();
  if (edge(en) !== edge(text))
    issues.push(
      issue('warning', 'whitespace', 'leading or trailing whitespace differs from English')
    );
  if (text === en && /\p{L}/u.test(en))
    issues.push(issue('warning', 'untranslated', 'identical to English'));
  return issues;
}

/**
 * Validate every shipped translation against English (catalog level).
 * @returns {{ catalog: string, locale: string, key: string, level: string, code: string, message: string }[]}
 */
export function validateCatalogs({ locales, catalogs = listCatalogs() }) {
  const problems = [];
  for (const catalog of catalogs) {
    const source = readCatalog(catalog, SOURCE_LOCALE);
    for (const [key, en] of source) {
      for (const found of validateSource(en, catalog.syntax)) {
        problems.push({ catalog: catalog.id, locale: SOURCE_LOCALE, key, ...found });
      }
    }
    for (const locale of locales) {
      if (locale === SOURCE_LOCALE) continue;
      const messages = readCatalog(catalog, locale);
      if (!messages) continue; // file presence is check-i18n-parity's and supported-locales.spec's job
      for (const [key, en] of source) {
        if (!messages.has(key)) continue; // key parity is check-i18n-parity's job
        for (const found of validateMessage({
          en,
          text: messages.get(key),
          locale,
          syntax: catalog.syntax
        })) {
          problems.push({ catalog: catalog.id, locale, key, ...found });
        }
      }
    }
  }
  return problems;
}

export function formatProblems(problems) {
  return problems
    .map((p) => `${p.locale} ${p.catalog}:${p.key} [${p.code}] ${p.message}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Security-critical texts (back-translation after a translator's changes)
// ---------------------------------------------------------------------------

/**
 * Keys whose meaning protects the user: sign-in, unlocking, encryption,
 * recovery, 2FA, passwords, account deletion, sharing, backups and export.
 * A translator's change here is back-translated to English and compared before
 * it ships (Arabic plan, Phase 3).
 */
export const CRITICAL_KEY_PREFIXES = [
  'notes:auth.',
  'notes:e2e.',
  'notes:encryption.',
  'notes:security.',
  'notes:registration.',
  'notes:local_mode.',
  'notes:app_lock.',
  'notes:share.',
  'notes:sharing.',
  'notes:settings_page.security.',
  'notes:settings_page.backup.',
  'notes:settings_page.export_import.',
  'notes:settings_page.manage_account.',
  'notes:settings_page.account.',
  'common:auth.',
  'common:password.',
  'common:profile.',
  'tasks/auth:',
  'tasks/e2e:',
  'tasks/unlock_e2e:',
  'tasks/local_mode:',
  'tasks/profile:',
  'tasks/share:',
  'tasks/settings:'
];

export function isCriticalKey(qualifiedKey) {
  return CRITICAL_KEY_PREFIXES.some((prefix) => qualifiedKey.startsWith(prefix));
}

export const REPO_PATHS = { REPO_ROOT, I18N_SRC, TRANSLATIONS_DIR };
