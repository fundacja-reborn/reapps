/**
 * Secure client IP extraction with proxy chain validation.
 *
 * Strategy:
 * 1. Get the direct connection IP via event.getClientAddress()
 * 2. Only trust X-Forwarded-For if the direct connection comes from
 *    a trusted proxy (explicit list) or a private/internal IP
 * 3. Parse XFF right-to-left, returning the first non-trusted IP
 * 4. Fall back to the direct connection IP when headers are absent or untrusted
 *
 * Configure trusted proxies via TRUSTED_PROXIES env var (comma-separated IPs).
 * Private/internal IPs (RFC 1918, loopback, IPv6 local) are trusted implicitly
 * — this covers Docker networks and local development.
 */

import type { RequestEvent } from '@sveltejs/kit';

const TRUSTED_PROXY_IPS: ReadonlySet<string> = new Set(
	(process.env.TRUSTED_PROXIES ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
);

const PRIVATE_IP_PATTERNS: readonly RegExp[] = [
	/^127\./, // IPv4 loopback
	/^10\./, // Class A private
	/^172\.(1[6-9]|2\d|3[01])\./, // Class B private
	/^192\.168\./, // Class C private
	/^::1$/, // IPv6 loopback
	/^::ffff:127\./, // IPv4-mapped loopback
	/^fc00:/, // IPv6 unique local
	/^fe80:/ // IPv6 link-local
];

function isPrivateIp(ip: string): boolean {
	return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

function isTrustedProxy(ip: string): boolean {
	return TRUSTED_PROXY_IPS.has(ip) || isPrivateIp(ip);
}

export function getClientIp(event: RequestEvent): string {
	let directIp: string;
	try {
		directIp = event.getClientAddress();
	} catch {
		return 'unknown';
	}

	// Only trust X-Forwarded-For when the direct connection is from a trusted proxy
	if (isTrustedProxy(directIp)) {
		const xff = event.request.headers.get('x-forwarded-for');
		if (xff) {
			const ips = xff
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);

			// Walk right-to-left: skip trusted proxies, return first untrusted IP
			for (let i = ips.length - 1; i >= 0; i--) {
				if (!isTrustedProxy(ips[i])) {
					return ips[i];
				}
			}
		}
	}

	return directIp;
}
