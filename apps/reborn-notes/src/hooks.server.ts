import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { authLimiter, refreshLimiter, registerLimiter, powLimiter } from '$lib/server/rate-limit';
import { getClientIp } from '$lib/server/client-ip';
import { verifyToken } from '@reborn/auth/server';
import { createLogger } from '@reborn/utils';
import {
  findIdempotencyKey,
  storeIdempotencyResponse,
  cleanupExpiredKeys
} from '@reborn/database';

const logger = createLogger('notes-hooks');

// ── Rate-limited auth routes ──────────────────────────────────────

const BASE = process.env.PUBLIC_BASE_PATH ?? '';
const RATE_LIMITED_AUTH = new Set([`${BASE}/api/auth/login`, `${BASE}/api/auth/2fa/verify`]);
const RATE_LIMITED_REFRESH = new Set([`${BASE}/api/auth/refresh`]);
const RATE_LIMITED_REGISTER = new Set([`${BASE}/api/auth/register`]);
const RATE_LIMITED_POW = new Set([`${BASE}/api/auth/pow`]);

/** Maximum request body size: 1 MB. Larger payloads are rejected immediately. */
const MAX_BODY_BYTES = 1 * 1024 * 1024;

// ── Rate limiting ─────────────────────────────────────────────────

const rateLimitHandle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (event.request.method === 'POST') {
    if (RATE_LIMITED_AUTH.has(pathname)) {
      const ip = getClientIp(event);
      if (!authLimiter.check(ip)) {
        const retryAfter = authLimiter.retryAfter(ip);
        return json(
          { success: false, error: 'Too many requests. Please try again later.' },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } }
        );
      }
    }

    if (RATE_LIMITED_REFRESH.has(pathname)) {
      const ip = getClientIp(event);
      if (!refreshLimiter.check(ip)) {
        const retryAfter = refreshLimiter.retryAfter(ip);
        return json(
          { success: false, error: 'Too many requests. Please try again later.' },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } }
        );
      }
    }

    if (RATE_LIMITED_REGISTER.has(pathname)) {
      const ip = getClientIp(event);
      if (!registerLimiter.check(ip)) {
        const retryAfter = registerLimiter.retryAfter(ip);
        return json(
          { success: false, error: 'Too many requests. Please try again later.' },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } }
        );
      }
    }
  }

  if (event.request.method === 'GET') {
    if (RATE_LIMITED_POW.has(pathname)) {
      const ip = getClientIp(event);
      if (!powLimiter.check(ip)) {
        const retryAfter = powLimiter.retryAfter(ip);
        return json(
          { success: false, error: 'Too many requests. Please try again later.' },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } }
        );
      }
    }
  }

  return resolve(event);
};

// ── Request size limit ────────────────────────────────────────────

const requestSizeHandle: Handle = async ({ event, resolve }) => {
  const contentLength = event.request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return json({ success: false, error: 'Request body too large' }, { status: 413 });
  }
  return resolve(event);
};

// ── Authentication ────────────────────────────────────────────────

const authHandle: Handle = async ({ event, resolve }) => {
  try {
    // Get token from Authorization header (API requests)
    let token: string | undefined;
    const authHeader = event.request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (token) {
      const tokenData = await verifyToken(token, 'access');
      if (tokenData) {
        event.locals.userId = tokenData.userId;
      }
    }
  } catch {
    // Don't fail the request, just continue without auth
  }

  return resolve(event);
};

// ── Security headers ──────────────────────────────────────────────

const securityHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );

  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // CSP is managed by SvelteKit kit.csp (nonce-based) in svelte.config.js
  }

  return response;
};

// ── Idempotency ───────────────────────────────────────────────────

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const idempotencyHandle: Handle = async ({ event, resolve }) => {
  const idempotencyKey = event.request.headers.get('idempotency-key');
  if (!idempotencyKey) return resolve(event);

  const { method } = event.request;
  if (!MUTATION_METHODS.has(method)) return resolve(event);

  const { pathname } = event.url;
  if (pathname.includes('/api/auth/')) return resolve(event);

  // userId set by authHandle earlier in sequence
  const userId = event.locals.userId;
  if (!userId) return resolve(event);

  // Check for cached response
  const cached = await findIdempotencyKey(idempotencyKey, userId);
  if (cached) {
    return new Response(cached.response_body, {
      status: cached.response_status,
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotent-Replay': 'true'
      }
    });
  }

  // Process request normally
  const response = await resolve(event);

  // Cache only successful responses — caching errors would make retries useless
  // (pushSilently reuses the same Idempotency-Key for all retry attempts)
  if (response.status >= 200 && response.status < 300) {
    const clone = response.clone();
    const body = await clone.text();
    void storeIdempotencyResponse(idempotencyKey, userId, method, pathname, response.status, body);
  }

  // Lazy cleanup (~1% of requests)
  if (Math.random() < 0.01) {
    void cleanupExpiredKeys();
  }

  return response;
};

const SUPPORTED_LOCALES_SERVER = ['en', 'pl', 'de', 'es', 'fr'] as const;

// Locale detection middleware
const localeHandle: Handle = async ({ event, resolve }) => {
  const cookieLocale = event.cookies.get('locale');
  let locale = 'en';

  if (cookieLocale && (SUPPORTED_LOCALES_SERVER as readonly string[]).includes(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLanguage = event.request.headers.get('accept-language');
    if (acceptLanguage) {
      const languages = acceptLanguage
        .split(',')
        .map((lang) => lang.split(';')[0].trim().split('-')[0].toLowerCase());
      const match = languages.find((lang) =>
        (SUPPORTED_LOCALES_SERVER as readonly string[]).includes(lang)
      );
      if (match) locale = match;
    }
  }

  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', locale)
  });
};

export const handle = sequence(requestSizeHandle, rateLimitHandle, authHandle, idempotencyHandle, localeHandle, securityHandle);
