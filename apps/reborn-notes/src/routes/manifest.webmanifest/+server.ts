import { env } from '$env/dynamic/public';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * Dynamic PWA manifest.
 *
 * Using a server route instead of a static file so that `start_url` and `scope`
 * can be configured via PUBLIC_BASE_PATH at build/runtime time.
 *
 * Deployment examples:
 *   dev  (port 4300): PUBLIC_BASE_PATH=""   → start_url: "/"
 *   prod (same-origin): PUBLIC_BASE_PATH="/notes" → start_url: "/notes"
 */
// Bump when icon files change to bypass browser HTTP cache and Android
// adaptive-icon cache. Keep in sync with the value in `src/app.html`.
const ICON_VERSION = '2026-04-26';

export const GET: RequestHandler = () => {
  const base = env.PUBLIC_BASE_PATH ?? '';
  const v = `?v=${ICON_VERSION}`;

  const manifest = {
    name: 're/notes',
    short_name: 're/notes',
    description: 'Zero-knowledge Markdown notes with end-to-end encryption',
    start_url: base ? `${base}/` : '/',
    scope: base ? `${base}/` : '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#FFD43B',
    orientation: 'portrait-primary',
    lang: 'pl',
    icons: [
      {
        src: `${base}/icons/icon-192.png${v}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: `${base}/icons/icon-512.png${v}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: `${base}/icons/icon-512-maskable.png${v}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: `${base}/favicon.svg${v}`,
        sizes: 'any',
        type: 'image/svg+xml'
      }
    ]
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=3600'
    }
  });
};
