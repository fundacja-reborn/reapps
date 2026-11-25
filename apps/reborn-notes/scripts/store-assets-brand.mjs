/**
 * re/notes brand for the store-asset generators (Faza 5, D6):
 * `scripts/gen-store-assets-sources.mjs` and
 * `scripts/postfix-android-adaptive-icon.mjs` at the repo root read this file
 * from the app they run for (`pnpm gen:store-assets`).
 *
 * The white "n" glyph paths from static/icons/icon.svg (viewBox 0 0 1178 1178),
 * extracted so they can be recomposed on different backgrounds (full-bleed
 * icon, adaptive foreground, Android VectorDrawable). GLYPH_MARKERS lets each
 * consumer fail the build if icon.svg ever drifts from these paths.
 */

/** Launcher name, as on the home screen. */
export const APP_NAME = 're/notes';

/** Brand colour: icon background, Play feature graphic. */
export const BRAND_COLOR = '#FFD43B';

/** The brand mark (circle + glyph), relative to the app directory. */
export const BRAND_SVG = 'static/icons/icon.svg';

/** The wordmark on the Play feature graphic, relative to the app directory. */
export const WORDMARK_SVG = 'static/logo-black.svg';

/** SVG viewBox edge of the brand mark - all glyph coordinates live in it. */
export const BRAND_VIEWBOX = 1178;

/** The glyph outlines (SVG / VectorDrawable path data), drawn white. */
export const GLYPH_PATHS = [
  'M411.679,634.45l-0,224.006l-151.603,-0l-0,-224.006l151.603,-0Z',
  'M561.912,538.318l0,96.422l-151.33,0l0,-334.392l151.33,-0l0,52.418c13.84,-14.166 29.82,-26.248 47.941,-36.246c33.501,-18.483 71.43,-27.724 113.787,-27.724c40.816,-0 77.398,10.204 109.743,30.612c32.346,20.409 57.76,46.978 76.243,79.709c18.483,32.73 27.725,67.964 27.725,105.7l-0,353.489l-151.331,0l0,-319.988c0,-33.116 -10.397,-60.07 -31.19,-80.864c-20.794,-20.793 -47.748,-31.19 -80.864,-31.19c-21.563,-0 -40.817,4.621 -57.759,13.862c-16.943,9.242 -30.228,22.334 -39.855,39.277c-9.626,16.943 -14.44,36.581 -14.44,58.915Z'
];

/** Substrings that must keep existing in BRAND_SVG for the paths above to be current. */
export const GLYPH_MARKERS = ['M411.679,634.45', 'M561.912,538.318'];
