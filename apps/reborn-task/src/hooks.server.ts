import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { authLimiter, refreshLimiter, registerLimiter, powLimiter } from '$lib/server/rate-limit';
import { getClientIp } from '$lib/server/client-ip';
import {
	findIdempotencyKey,
	storeIdempotencyResponse,
	cleanupExpiredKeys,
	cleanupExpiredShares
} from '@reborn/database';
import { getShareOgStrings } from '$lib/server/share-og';
import { getAppLoadingStrings } from '$lib/server/app-loading-strings';

const BASE = process.env.PUBLIC_BASE_PATH ?? '';
const RATE_LIMITED_AUTH = new Set([
	`${BASE}/api/auth/login`,
	`${BASE}/api/auth/2fa/verify`,
]);
const RATE_LIMITED_REFRESH = new Set([`${BASE}/api/auth/refresh`]);
const RATE_LIMITED_REGISTER = new Set([`${BASE}/api/auth/register`]);
const RATE_LIMITED_POW = new Set([`${BASE}/api/auth/pow`]);
const MAX_BODY_BYTES = 1 * 1024 * 1024;

const rateLimitHandle: Handle = async ({ event, resolve }) => {
	if (event.request.method === 'POST') {
		const { pathname } = event.url;
		if (RATE_LIMITED_AUTH.has(pathname)) {
			const ip = getClientIp(event);
			if (!authLimiter.check(ip)) {
				return json(
					{ success: false, error: 'Too many requests. Please try again later.' },
					{ status: 429, headers: { 'Retry-After': String(authLimiter.retryAfter(ip)) } }
				);
			}
		}
		if (RATE_LIMITED_REFRESH.has(pathname)) {
			const ip = getClientIp(event);
			if (!refreshLimiter.check(ip)) {
				return json(
					{ success: false, error: 'Too many requests. Please try again later.' },
					{ status: 429, headers: { 'Retry-After': String(refreshLimiter.retryAfter(ip)) } }
				);
			}
		}
		if (RATE_LIMITED_REGISTER.has(pathname)) {
			const ip = getClientIp(event);
			if (!registerLimiter.check(ip)) {
				return json(
					{ success: false, error: 'Too many requests. Please try again later.' },
					{ status: 429, headers: { 'Retry-After': String(registerLimiter.retryAfter(ip)) } }
				);
			}
		}
	}
	if (event.request.method === 'GET') {
		const { pathname } = event.url;
		if (RATE_LIMITED_POW.has(pathname)) {
			const ip = getClientIp(event);
			if (!powLimiter.check(ip)) {
				return json(
					{ success: false, error: 'Too many requests. Please try again later.' },
					{ status: 429, headers: { 'Retry-After': String(powLimiter.retryAfter(ip)) } }
				);
			}
		}
	}
	return resolve(event);
};

const requestSizeHandle: Handle = async ({ event, resolve }) => {
	const contentLength = event.request.headers.get('content-length');
	if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
		return json({ success: false, error: 'Request body too large' }, { status: 413 });
	}
	return resolve(event);
};

const logger = createLogger('hooks.server');

// Authentication middleware
const authHandle: Handle = async ({ event, resolve }) => {
	try {
		// Read access token from cookie (legacy path) or Authorization header
		// (the canonical path used by api-client / authFetch).
		let token = event.cookies.get('reborn_task_token');
		if (!token) {
			const authHeader = event.request.headers.get('authorization');
			if (authHeader?.startsWith('Bearer ')) {
				token = authHeader.slice(7);
			}
		}

		if (token) {
			const tokenData = await verifyToken(token, 'access');
			if (tokenData) {
				event.locals.userId = tokenData.userId;
			} else if (event.cookies.get('reborn_task_token')) {
				event.cookies.delete('reborn_task_token', { path: '/' });
			}
		}
	} catch (error: unknown) {
		logger.error('Auth middleware error:', error);
		// Don't fail the request, just continue without auth
	}

	return resolve(event);
};

const SUPPORTED_LOCALES_SERVER = ['en', 'pl', 'de', 'es', 'fr'] as const;

const SHARE_PATH_PREFIX = `${BASE}/s/`;

function escAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Locale detection middleware. Also injects OG / description meta tags for
// the public share page (/s/<slug>) so link-unfurl bots (Signal, Slack,
// Discord, iMessage) show a localized "End-to-end encrypted snapshot of a
// task shared with you" preview. The bots fetch the URL with no cookies and
// usually no Accept-Language, so we fall back to 'en' by default. SSR is
// disabled app-wide (+layout.ts), so this transformPageChunk is the only
// chance to put crawler-visible metadata into the response.
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

	const isSharePage = event.url.pathname.startsWith(SHARE_PATH_PREFIX);

	const loading = getAppLoadingStrings(locale);
	const initLoadingMsg = escAttr(loading.initLoading);
	const stallMsg = escAttr(loading.stall);
	const offlineMsg = escAttr(loading.offline);

	return resolve(event, {
		transformPageChunk: ({ html }) => {
			let out = html
				.replace('%lang%', locale)
				.replace('%init_loading_msg%', initLoadingMsg)
				.replace('%stall_msg%', stallMsg)
				.replace('%offline_msg%', offlineMsg);
			if (!isSharePage) return out;

			const og = getShareOgStrings(locale);
			const ogImage = `${event.url.origin}${BASE}/icons/icon-512.png`;
			const pageUrl = `${event.url.origin}${event.url.pathname}`;
			const title = escAttr(og.title);
			const description = escAttr(og.description);
			const tags = [
				`<meta name="description" content="${description}" />`,
				`<meta property="og:title" content="${title}" />`,
				`<meta property="og:description" content="${description}" />`,
				`<meta property="og:type" content="website" />`,
				`<meta property="og:url" content="${escAttr(pageUrl)}" />`,
				`<meta property="og:image" content="${escAttr(ogImage)}" />`,
				`<meta name="twitter:card" content="summary" />`,
				`<meta name="twitter:title" content="${title}" />`,
				`<meta name="twitter:description" content="${description}" />`
			].join('\n\t\t');

			return out.replace(
				'<title>re/task</title>',
				`<title>${title}</title>\n\t\t${tags}`
			);
		}
	});
};

// Security headers middleware
const securityHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Add security headers
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
	);

	// Production-only security headers
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

// ── Lazy cleanup of expired / revoked share snapshots ─────────────
const shareCleanupHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (Math.random() < 0.005) {
		void cleanupExpiredShares();
	}
	return response;
};

// Combine all handles
export const handle = sequence(
	requestSizeHandle,
	rateLimitHandle,
	authHandle,
	idempotencyHandle,
	shareCleanupHandle,
	localeHandle,
	securityHandle
);
