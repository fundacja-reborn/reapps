/**
 * Shared brand constants for the store-asset generators (Faza 5, D6).
 *
 * The white "n" glyph paths from static/icons/icon.svg (viewBox 0 0 1178 1178),
 * extracted so they can be recomposed on different backgrounds (full-bleed
 * icon, adaptive foreground, Android VectorDrawable). GLYPH_MARKERS lets each
 * consumer fail the build if icon.svg ever drifts from these paths.
 */

export const BRAND_YELLOW = '#FFD43B';

/** SVG viewBox edge of the brand mark - all glyph coordinates live in it. */
export const BRAND_VIEWBOX = 1178;

export const GLYPH_PATH_1 = 'M411.679,634.45l-0,224.006l-151.603,-0l-0,-224.006l151.603,-0Z';
export const GLYPH_PATH_2 =
  'M561.912,538.318l0,96.422l-151.33,0l0,-334.392l151.33,-0l0,52.418c13.84,-14.166 29.82,-26.248 47.941,-36.246c33.501,-18.483 71.43,-27.724 113.787,-27.724c40.816,-0 77.398,10.204 109.743,30.612c32.346,20.409 57.76,46.978 76.243,79.709c18.483,32.73 27.725,67.964 27.725,105.7l-0,353.489l-151.331,0l0,-319.988c0,-33.116 -10.397,-60.07 -31.19,-80.864c-20.794,-20.793 -47.748,-31.19 -80.864,-31.19c-21.563,-0 -40.817,4.621 -57.759,13.862c-16.943,9.242 -30.228,22.334 -39.855,39.277c-9.626,16.943 -14.44,36.581 -14.44,58.915Z';

export const GLYPH_PATHS =
  `<path d="${GLYPH_PATH_1}"/>` + `<path d="${GLYPH_PATH_2}"/>`;

/** Substrings that must keep existing in icon.svg for the paths above to be current. */
export const GLYPH_MARKERS = ['M411.679,634.45', 'M561.912,538.318'];
