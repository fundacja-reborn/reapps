import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isProduction = process.env.NODE_ENV === 'production';

// Native (Capacitor) build target. The exact same client build, but emitted as
// a static SPA that the native shell bundles and loads from a local custom
// scheme (https://localhost on Android, capacitor://localhost on iOS). It talks
// to the remote API cross-origin. Selected via BUILD_TARGET=native; the web
// targets (adapter-node / adapter-auto) are left byte-identical when unset.
const isNative = process.env.BUILD_TARGET === 'native';

// Native CSP connect-src needs the remote API origin, derived from the build's
// PUBLIC_API_BASE_URL (e.g. https://reapps.eu/notes/api -> https://reapps.eu).
// CapacitorHttp routes fetch through the native layer and bypasses CSP, but this
// keeps connect-src correct as defense-in-depth / if the transport ever changes.
const nativeApiOrigin =
  isNative && process.env.PUBLIC_API_BASE_URL
    ? new URL(process.env.PUBLIC_API_BASE_URL).origin
    : null;

function selectAdapter() {
  if (isNative) {
    // SPA mode: a single index.html fallback + client-side routing. The native
    // shell always serves index.html as its entry point.
    //
    // strict:false - the /api/* server endpoints (+server.ts) are dead code in
    // the static bundle (the native client talks to the remote API, there is no
    // Node server in the shell). They are neither prerendered nor covered by the
    // HTML fallback, so strict mode would abort the build on them. They are
    // simply omitted from the static output.
    //
    // Output to build-native/ (not build/) so the static SPA never clobbers the
    // web adapter-node output in build/ - otherwise `cap sync` could copy a
    // Node server build into the native shell. Capacitor's webDir points here.
    return adapterStatic({
      pages: 'build-native',
      assets: 'build-native',
      fallback: 'index.html',
      strict: false
    });
  }
  return isProduction ? adapterNode() : adapterAuto();
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: selectAdapter(),
    // CSRF origin check OFF. The native (Capacitor) client is cross-origin by
    // design - the WebView loads from a local scheme (https://localhost on
    // Android, capacitor://localhost on iOS) and talks to the remote API.
    // SvelteKit's default `checkOrigin` forbids any cross-origin
    // POST/PUT/PATCH/DELETE that carries a "form" content-type, which 403s every
    // bodiless native mutation (note / folder / tag / saved-search delete, note
    // restore - they send no Content-Type, unlike POST/PATCH which declare
    // application/json and slip through) while same-origin web never trips it.
    // So the check only ever rejected the legitimate native client. Safe to
    // disable: API auth is bearer-token (Authorization header, never an ambient
    // cookie, so it is not auto-attached cross-site) and the lone cookie - the
    // web refresh_token - is httpOnly + SameSite=Lax (never sent cross-site).
    // The origin check is redundant with those defenses. `trustedOrigins: ['*']`
    // is SvelteKit 2.63's non-deprecated spelling of "trust every origin" (the
    // old `checkOrigin: false` is deprecated); the wildcard also covers the
    // native request that carries no Origin header at all, which an explicit
    // allowlist could not. Found in native smoke 2026-06-28; see guideline 36.
    csrf: { trustedOrigins: ['*'] },
    // Native prerenders the SPA fallback; SvelteKit cannot fill `%sveltekit.nonce%`
    // in a static page, so native uses a nonce-free template variant. Web keeps the
    // nonce template (SSR fills the nonce per request for the nonce-mode CSP).
    files: {
      appTemplate: isNative ? 'src/app.native.html' : 'src/app.html'
    },
    // The native shell loads assets from the local bundle - a Service Worker
    // adds only a cache layer that can serve a stale shell after a store
    // update, so SvelteKit's auto-registration is off there (the SW file is
    // still emitted; it just never registers). hooks.client.ts additionally
    // unregisters SWs left behind by earlier dev builds. Web keeps registering
    // as before.
    serviceWorker: {
      register: !isNative
    },
    // BASE_PATH controls same-origin deployment path (e.g. "/notes").
    // Empty in dev. Set PUBLIC_BASE_PATH=/notes in production env. Native always
    // loads from the scheme root, so base is forced empty there.
    //
    // `paths.relative: false` forces absolute asset URLs (`/notes/_app/...`)
    // instead of SvelteKit 2's default relative (`./_app/...`). The service
    // worker serves the cached `${base}/` shell HTML as SPA fallback for any
    // navigation under base (F5 on `/notes/notes/<id>`, `/notes/folders/<id>`,
    // `/notes/s/<slug>` etc.). With relative paths the shell's `./_app/...`
    // resolves against the current URL and 404s every chunk; absolute paths
    // work identically from every URL the shell can be served at. Under the
    // native scheme root this resolves to `/_app/...` against http://localhost,
    // served from the bundled assets.
    paths: {
      base: isNative ? '' : (process.env.PUBLIC_BASE_PATH ?? ''),
      relative: false
    },
    alias: {
      $lib: './src/lib'
    },
    // Web (SSR) injects a per-request nonce. Native is fully static (no server to
    // mint a nonce) so it uses hashes - SvelteKit hashes the inline scripts/styles
    // in app.native.html at build time. (Faza 0 omitted CSP on native; Faza 1
    // restores it hash-based.)
    csp: {
      mode: isNative ? 'hash' : 'nonce',
      directives: {
        'default-src': ['self'],
        // nonce/hash is auto-injected by `mode` above. Do NOT add a literal
        // 'nonce' token here - browsers read it as the hostname `https://nonce`
        // (harmless but pollutes the CSP and confuses debugging in Firefox).
        'script-src': ['self', 'wasm-unsafe-eval'],
        'style-src': ['self', 'unsafe-inline'],
        // Hash mode (native) nullifies 'unsafe-inline' in style-src, which would
        // block Svelte's runtime inline style attributes (style="..."). Keep them
        // allowed via style-src-attr. Web (nonce mode) is unaffected.
        ...(isNative ? { 'style-src-attr': ['unsafe-inline'] } : {}),
        'img-src': ['self', 'data:', 'blob:', 'https:'],
        'font-src': ['self', 'data:'],
        'connect-src': isNative
          ? ['self', ...(nativeApiOrigin ? [nativeApiOrigin] : [])]
          : isProduction
            ? ['self']
            : ['self', 'ws:', 'http://localhost:*', 'ws://localhost:*'],
        'frame-ancestors': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'object-src': ['none']
      }
    }
  }
};

export default config;
