#!/usr/bin/env node
/**
 * Render the @capacitor/assets source images of a native app from its PWA
 * brand (Faza 5, D6; shared by re/notes and re/task).
 *
 * Run from the app directory (`pnpm gen:store-assets`): the brand comes from
 * the app's `scripts/store-assets-brand.mjs` - the brand mark SVG (re/notes:
 * yellow #FFD43B circle with a white "n"; re/task: green #43a047 circle with a
 * white "t"; the PWA icon IS the product icon, Michal 2026-06-11), its colour,
 * glyph paths and wordmark. This script rasterizes the five inputs
 * @capacitor/assets expects in assets/, mirroring the PWA maskable icon's
 * full-bleed composition:
 *
 *   icon-only.png        1024  full-bleed brand square (opaque - iOS app
 *                              icons reject alpha) + base for legacy Android
 *   icon-foreground.png  1024  glyph on transparency (adaptive foreground;
 *                              glyph spans ~53% of the canvas, inside the
 *                              ~61% adaptive safe zone)
 *   icon-background.png  1024  solid brand yellow (adaptive background)
 *   splash.png           2732  brand circle centered on white
 *   splash-dark.png      2732  brand circle centered on near-black (#0A0A0A,
 *                              matches the app's dark --background)
 *
 * Also renders the Play Store feature graphic (not a @capacitor/assets
 * input - the fan-out only picks up the five names above and ignores it):
 *
 *   feature-graphic.png  1024x500  the app wordmark on the brand colour
 *                                  (locale-neutral - the brand name is the
 *                                  same in every locale)
 *
 * Then `pnpm gen:store-assets` (package.json) runs the pinned
 * @capacitor/assets to fan these out into android/ mipmaps+drawables and
 * ios/ asset catalogs. Re-run only when the brand changes; outputs are
 * committed (the stores build from the repo, not from this script).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

// The app to render for: its directory (default: the current one).
const appDir = resolve(process.argv[2] ?? process.cwd());
const { BRAND_COLOR, BRAND_SVG, BRAND_VIEWBOX, GLYPH_MARKERS, GLYPH_PATHS, WORDMARK_SVG } =
  await import(pathToFileURL(resolve(appDir, 'scripts/store-assets-brand.mjs')).href);
const brandSvgPath = resolve(appDir, BRAND_SVG);
const wordmarkSvgPath = resolve(appDir, WORDMARK_SVG);
const outDir = resolve(appDir, 'assets');
const SPLASH_LIGHT_BG = '#ffffff';
// App dark theme --background is oklch(0.145 0 0) = #0a0a0a (packages/ui
// global.css). Match it exactly so the native splash, the app.html loader, the
// Android windowSplashScreenBackground @color and the loaded app all sit on the
// same near-black - no brightness staircase on a system-dark cold start.
const SPLASH_DARK_BG = '#0a0a0a';
const SPLASH_SIZE = 2732;
const SPLASH_LOGO_SIZE = 600;
const ICON_SIZE = 1024;
const FEATURE_WIDTH = 1024;
const FEATURE_HEIGHT = 500;
// 1417x262 wordmark source -> 700x129 on the canvas: focal point centered,
// ~162px side / ~185px top-bottom margins keep it inside Play's crop-safe zone.
const FEATURE_WORDMARK_WIDTH = 700;

// The white glyph paths from the brand SVG live in the app's
// store-assets-brand.mjs (shared with the Android vector-icon postfix); the
// guard below fails the build if the SVG ever changes shape without updating
// them.
const brandSvg = readFileSync(brandSvgPath, 'utf-8');
if (!GLYPH_MARKERS.every((m) => brandSvg.includes(m))) {
  throw new Error(
    `gen-store-assets-sources: ${BRAND_SVG} changed - update scripts/store-assets-brand.mjs so the store assets keep matching the brand.`
  );
}

const svg = (size, body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${BRAND_VIEWBOX} ${BRAND_VIEWBOX}">${body}</svg>`
  );

const glyphGroup = `<g fill="#ffffff" fill-rule="evenodd">${GLYPH_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>`;

async function renderIcon(name, body) {
  await sharp(svg(ICON_SIZE, body)).png().toFile(resolve(outDir, name));
  console.log(`gen-store-assets-sources: wrote assets/${name}`);
}

async function renderFeatureGraphic(name) {
  // The wordmark on the brand colour (not the icon on dark) follows Google's
  // preview-asset guidelines: avoid white/dark-gray backgrounds (they blend
  // with the store themes) and don't repeat the app icon - the graphic always
  // renders next to the icon and app name in featured/collection cards.
  const wordmark = await sharp(wordmarkSvgPath)
    .resize({ width: FEATURE_WORDMARK_WIDTH })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: FEATURE_WIDTH,
      height: FEATURE_HEIGHT,
      channels: 3,
      background: BRAND_COLOR
    }
  })
    .composite([{ input: wordmark, gravity: 'center' }])
    // composite() promotes to RGBA; Play Console wants 24-bit PNG, no alpha
    .removeAlpha()
    .png()
    .toFile(resolve(outDir, name));
  console.log(`gen-store-assets-sources: wrote assets/${name}`);
}

async function renderSplash(name, background) {
  // The brand circle (original brand SVG, transparent corners) centered on a
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
const brandSquare = `<rect width="${BRAND_VIEWBOX}" height="${BRAND_VIEWBOX}" fill="${BRAND_COLOR}"/>`;
await renderIcon('icon-only.png', `${brandSquare}${glyphGroup}`);
await renderIcon('icon-foreground.png', glyphGroup);
await renderIcon('icon-background.png', brandSquare);
await renderSplash('splash.png', SPLASH_LIGHT_BG);
await renderSplash('splash-dark.png', SPLASH_DARK_BG);
await renderFeatureGraphic('feature-graphic.png');
