import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTE_FONT_BASE_STACK, NOTE_FONT_FAMILIES } from './note-font';

/**
 * The note fonts (issue #546) live in four places that only work together:
 * the registry in note-font.ts, the @font-face rules in note-fonts.css, the
 * files in static/fonts/note/ and the service worker, which must keep those
 * files out of its pre-cache. Nothing at build time ties them to each other -
 * a renamed family or a missing file would just render in the fallback font.
 */

const APP = resolve(__dirname, '../../..');
const css = readFileSync(resolve(APP, 'src/styles/note-fonts.css'), 'utf-8');
const FONTS_DIR = resolve(APP, 'static/fonts/note');

interface Face {
  family: string;
  style: string;
  weight: string;
  url: string;
  hasRange: boolean;
  /** `size-adjust` in percent; 100 when the rule has none. */
  sizeAdjust: number;
}

const faces: Face[] = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  family: /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? '',
  style: /font-style:\s*([a-z]+)/.exec(body)?.[1] ?? '',
  weight: /font-weight:\s*([0-9 ]+);/.exec(body)?.[1] ?? '',
  url: /url\('([^']+)'\)/.exec(body)?.[1] ?? '',
  hasRange: /unicode-range:/.test(body),
  sizeAdjust: Number(/size-adjust:\s*([0-9.]+)%/.exec(body)?.[1] ?? 100)
}));

describe('note fonts: registry, stylesheet and files agree', () => {
  it('declares the same families in CSS as in the registry', () => {
    const inCss = [...new Set(faces.map((face) => face.family))].sort();
    const inRegistry = Object.values(NOTE_FONT_FAMILIES)
      .map((font) => font.family)
      .sort();
    expect(inCss).toEqual(inRegistry);
  });

  it.each(Object.values(NOTE_FONT_FAMILIES))(
    'has a @font-face for every face of $family',
    ({ family, faces: registered }) => {
      for (const face of registered) {
        const match = faces.filter((candidate) => {
          if (candidate.family !== family || candidate.style !== face.style) return false;
          const [min, max = min] = candidate.weight.split(' ').map(Number);
          return face.weight >= min && face.weight <= max;
        });
        expect(match.length, `${family} ${face.style} ${face.weight}`).toBeGreaterThan(0);
      }
    }
  );

  it('serves every face from static/fonts/note/ and the file exists', () => {
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face.url).toMatch(/^\/fonts\/note\/[a-z0-9-]+\/[a-z0-9-]+\.woff2$/);
      expect(existsSync(resolve(APP, 'static', face.url.slice(1))), face.url).toBe(true);
    }
  });

  it('ships no font file that the stylesheet does not use', () => {
    const used = new Set(faces.map((face) => face.url));
    const shipped = readdirSync(FONTS_DIR).flatMap((dir) =>
      readdirSync(resolve(FONTS_DIR, dir))
        .filter((file) => file.endsWith('.woff2'))
        .map((file) => `/fonts/note/${dir}/${file}`)
    );
    expect(shipped.filter((file) => !used.has(file))).toEqual([]);
  });

  it('limits every face to a unicode-range, so an unused script downloads nothing', () => {
    expect(faces.filter((face) => !face.hasRange).map((face) => face.url)).toEqual([]);
  });

  // The size adjustment is in the stylesheet, the line height that goes with
  // it in the registry (#546). One without the other gives larger letters on
  // the old line height, or wide lines around letters of the old size.
  it.each(Object.values(NOTE_FONT_FAMILIES))(
    'gives every face of $family the size-adjust the registry names',
    ({ family, sizeAdjust = 100 }) => {
      const adjusts = faces.filter((face) => face.family === family).map((face) => face.sizeAdjust);
      expect(adjusts.length).toBeGreaterThan(0);
      expect([...new Set(adjusts)]).toEqual([sizeAdjust]);
    }
  );

  it('pairs a larger size with a larger line height', () => {
    for (const { family, sizeAdjust = 100, leading = 1 } of Object.values(NOTE_FONT_FAMILIES)) {
      expect(leading >= sizeAdjust / 100, family).toBe(true);
    }
  });

  it('carries the license text next to each font (OFL-1.1 condition)', () => {
    for (const dir of readdirSync(FONTS_DIR)) {
      const license = resolve(FONTS_DIR, dir, 'OFL.txt');
      expect(existsSync(license), `${dir}/OFL.txt`).toBe(true);
      const text = readFileSync(license, 'utf-8');
      expect(text).toContain('SIL Open Font License, Version 1.1');
      // A Reserved Font Name would forbid shipping a subset under that name.
      expect(text.slice(0, 400)).not.toMatch(/Reserved Font Name/i);
    }
  });
});

describe('note fonts: wiring', () => {
  it('keeps the base stack in step with --font-sans in app.css', () => {
    const appCss = readFileSync(resolve(APP, 'src/app.css'), 'utf-8');
    const fontSans = /--font-sans:\s*([^;]+);/.exec(appCss)?.[1].replace(/\s+/g, ' ').trim();
    expect(fontSans).toBe(NOTE_FONT_BASE_STACK);
  });

  it('is left out of the service worker pre-cache and kept in its own cache', () => {
    const sw = readFileSync(resolve(APP, 'src/service-worker.ts'), 'utf-8');
    expect(sw).toContain('const NOTE_FONTS_PATH = `${base}/fonts/note/`;');
    expect(sw).toContain('files.filter((file) => !file.startsWith(NOTE_FONTS_PATH))');
    // The font cache must survive the clean-up of old versioned caches.
    expect(sw).toMatch(/key !== NOTE_FONTS_CACHE/);
  });
});
