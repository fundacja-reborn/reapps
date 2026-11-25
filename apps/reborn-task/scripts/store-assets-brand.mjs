/**
 * re/task brand for the store-asset generators:
 * `scripts/gen-store-assets-sources.mjs` and
 * `scripts/postfix-android-adaptive-icon.mjs` at the repo root read this file
 * from the app they run for (`pnpm gen:store-assets`). Same contract as
 * re/notes' file.
 *
 * The white "t" glyph from static/favicon.svg (viewBox 0 0 1178 1178): the
 * stem `<rect>` (written here as a path) plus the cross-bar outline. The PWA
 * icons are rendered from the same mark. GLYPH_MARKERS fails the build if
 * favicon.svg ever drifts from these paths.
 */

/** Launcher name, as on the home screen. */
export const APP_NAME = 're/task';

/** Brand colour (theme-color #43a047): icon background, Play feature graphic. */
export const BRAND_COLOR = '#43a047';

/** The brand mark (circle + glyph), relative to the app directory. */
export const BRAND_SVG = 'static/favicon.svg';

/** The wordmark on the Play feature graphic, relative to the app directory. */
export const WORDMARK_SVG = 'static/logo-black.svg';

/** SVG viewBox edge of the brand mark - all glyph coordinates live in it. */
export const BRAND_VIEWBOX = 1178;

/** The glyph outlines (SVG / VectorDrawable path data), drawn white. */
export const GLYPH_PATHS = [
  // <rect x="350.369" y="738.207" width="158.262" height="222.344"/>
  'M350.369,738.207l158.262,0l0,222.344l-158.262,0Z',
  'M509.744,738.207l0,-309.354l-258.763,-0l-0,-149.154l675.788,0l0,149.154l-258.763,-0l-0,309.354l-158.262,-0Z'
];

/** Substrings that must keep existing in BRAND_SVG for the paths above to be current. */
export const GLYPH_MARKERS = [
  'x="350.369" y="738.207" width="158.262" height="222.344"',
  'M509.744,738.207l0,-309.354'
];
