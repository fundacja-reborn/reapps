#!/usr/bin/env node
/**
 * Render the @capacitor/assets source images from the PWA brand (Faza 5, D6).
 *
 * Single source of truth for the native icons/splash is the existing brand
 * mark (static/icons/icon.svg - the yellow #FFD43B circle with the white
 * "n" glyph; Michal confirmed the PWA icon IS the product icon, 2026-06-11).
 * This script rasterizes the five inputs @capacitor/assets expects in
 * assets/, mirroring the PWA maskable icon's full-bleed composition:
 *
 *   icon-only.png        1024  full-bleed brand square (opaque - iOS app
 *                              icons reject alpha) + base for legacy Android
 *   icon-foreground.png  1024  glyph on transparency (adaptive foreground;
 *                              glyph spans ~53% of the canvas, inside the
 *                              ~61% adaptive safe zone)
 *   icon-background.png  1024  solid brand yellow (adaptive background)
 *   splash.png           2732  brand circle centered on white
 *   splash-dark.png      2732  brand circle centered on near-black (#1B1B1B,
 *                              matches the app's dark --background)
 *
 * Then `pnpm gen:store-assets` (package.json) runs the pinned
 * @capacitor/assets to fan these out into android/ mipmaps+drawables and
 * ios/ asset catalogs. Re-run only when the brand changes; outputs are
 * committed (the stores build from the repo, not from this script).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BRAND_YELLOW, GLYPH_MARKERS, GLYPH_PATHS } from './store-assets-glyph.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const brandSvgPath = resolve(appDir, 'static/icons/icon.svg');
const outDir = resolve(appDir, 'assets');
const SPLASH_LIGHT_BG = '#ffffff';
// App dark theme --background is oklch(0.145 0 0) (packages/ui global.css);
// #1B1B1B is its hex neighborhood - close enough for a sub-second splash.
const SPLASH_DARK_BG = '#1b1b1b';
const SPLASH_SIZE = 2732;
const SPLASH_LOGO_SIZE = 600;
const ICON_SIZE = 1024;

// The white glyph paths from icon.svg live in store-assets-glyph.mjs (shared
// with the Android vector-icon postfix); the guard below fails the build if
// icon.svg ever changes shape without updating them.
const brandSvg = readFileSync(brandSvgPath, 'utf-8');
if (!GLYPH_MARKERS.every((m) => brandSvg.includes(m))) {
  throw new Error(
    'gen-store-assets-sources: static/icons/icon.svg changed - update store-assets-glyph.mjs so the store assets keep matching the brand.'
  );
}

const svg = (size, body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1178 1178">${body}</svg>`
  );

const glyphGroup = `<g fill="#ffffff" fill-rule="evenodd">${GLYPH_PATHS}</g>`;

async function renderIcon(name, body) {
  await sharp(svg(ICON_SIZE, body)).png().toFile(resolve(outDir, name));
  console.log(`gen-store-assets-sources: wrote assets/${name}`);
}

async function renderSplash(name, background) {
  // The brand circle (original icon.svg, transparent corners) centered on a
  // solid background - neutral across all 5 locales (no text).
  const logo = await sharp(Buffer.from(brandSvg))
    .resize(SPLASH_LOGO_SIZE, SPLASH_LOGO_SIZE)
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: SPLASH_SIZE,
      height: SPLASH_SIZE,
      channels: 4,
      background
    }
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(resolve(outDir, name));
  console.log(`gen-store-assets-sources: wrote assets/${name}`);
}

mkdirSync(outDir, { recursive: true });
await renderIcon(
  'icon-only.png',
  `<rect width="1178" height="1178" fill="${BRAND_YELLOW}"/>${glyphGroup}`
);
await renderIcon('icon-foreground.png', glyphGroup);
await renderIcon('icon-background.png', `<rect width="1178" height="1178" fill="${BRAND_YELLOW}"/>`);
await renderSplash('splash.png', SPLASH_LIGHT_BG);
await renderSplash('splash-dark.png', SPLASH_DARK_BG);
