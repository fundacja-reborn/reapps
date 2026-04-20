/**
 * Simple in-memory rate limiter for SvelteKit server routes.
 *
 * Uses a per-IP counter with a sliding window. State lives in the Node.js
 * process — fine for single-instance deployments (VPS / Docker). For
 * multi-instance deploys, swap the Map for Redis or a shared store.
 */

export interface RateLimiter {
	check(ip: string): boolean;
	retryAfter(ip: string): number;
}

interface Entry {
	count: number;
	resetAt: number;
}

export function createRateLimiter(options: { maxRequests: number; windowMs: number }): RateLimiter {
	const { maxRequests, windowMs } = options;
	const store = new Map<string, Entry>();

	setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of store) {
			if (entry.resetAt < now) store.delete(key);
		}
	}, windowMs).unref();

	return {
		check(ip: string): boolean {
			const now = Date.now();
			const entry = store.get(ip);
			if (!entry || entry.resetAt < now) {
				store.set(ip, { count: 1, resetAt: now + windowMs });
				return true;
			}
			if (entry.count >= maxRequests) return false;
			entry.count++;
			return true;
		},

		retryAfter(ip: string): number {
			const entry = store.get(ip);
			if (!entry || entry.resetAt < Date.now()) return 0;
			return Math.ceil((entry.resetAt - Date.now()) / 1000);
		}
	};
}

// ── Per-username login lockout (tracks failures only) ─────────────

export interface LoginLockout {
	/** Returns true if the account is temporarily locked. */
	isLocked(key: string): boolean;
	/** Record a failed authentication attempt. */
	recordFailure(key: string): void;
	/** Clear failure history on successful authentication. */
	reset(key: string): void;
	/** Seconds remaining until lockout expires (0 if not locked). */
	retryAfter(key: string): number;
}

interface LockoutEntry {
	failures: number;
	resetAt: number;
}

export function createLoginLockout(options: {
	maxFailures: number;
	windowMs: number;
}): LoginLockout {
	const { maxFailures, windowMs } = options;
	const store = new Map<string, LockoutEntry>();

	setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of store) {
			if (entry.resetAt < now) store.delete(key);
		}
	}, windowMs).unref();

	return {
		isLocked(key: string): boolean {
			const entry = store.get(key.toLowerCase());
			if (!entry) return false;
			if (entry.resetAt < Date.now()) {
				store.delete(key.toLowerCase());
				return false;
			}
			return entry.failures >= maxFailures;
		},

		recordFailure(key: string): void {
			const normalized = key.toLowerCase();
			const now = Date.now();
			const entry = store.get(normalized);

			if (!entry || entry.resetAt < now) {
				store.set(normalized, { failures: 1, resetAt: now + windowMs });
				return;
			}
			entry.failures++;
		},

		reset(key: string): void {
			store.delete(key.toLowerCase());
		},

		retryAfter(key: string): number {
			const entry = store.get(key.toLowerCase());
			if (!entry || entry.resetAt < Date.now()) return 0;
			if (entry.failures < maxFailures) return 0;
			return Math.ceil((entry.resetAt - Date.now()) / 1000);
		}
	};
}

// ── Pre-configured limiters ───────────────────────────────────────

/** Login / 2FA verify: 10 attempts per 15 minutes per IP. */
export const authLimiter = createRateLimiter({ maxRequests: 10, windowMs: 15 * 60_000 });

/** Token refresh: 60 calls per 15 minutes per IP. */
export const refreshLimiter = createRateLimiter({ maxRequests: 60, windowMs: 15 * 60_000 });

/** Registration: 3 attempts per 60 minutes per IP. */
export const registerLimiter = createRateLimiter({ maxRequests: 3, windowMs: 60 * 60_000 });

/** PoW challenge: 10 requests per 5 minutes per IP. */
export const powLimiter = createRateLimiter({ maxRequests: 10, windowMs: 5 * 60_000 });

/** Per-username lockout: 5 failed login attempts per 15 min = temporary lockout. */
export const loginLockout = createLoginLockout({ maxFailures: 5, windowMs: 15 * 60_000 });

/** Per-userId lockout: 5 failed 2FA attempts per 15 min = temporary lockout. */
export const twoFactorLockout = createLoginLockout({ maxFailures: 5, windowMs: 15 * 60_000 });

/** Per-userId lockout: 5 failed delete-account attempts per 15 min = temporary lockout. */
export const deleteAccountLockout = createLoginLockout({ maxFailures: 5, windowMs: 15 * 60_000 });

/** Per-userId lockout: 5 failed change-password attempts per 15 min = temporary lockout. */
export const changePasswordLockout = createLoginLockout({ maxFailures: 5, windowMs: 15 * 60_000 });

/** Per-userId lockout: 5 failed 2FA disable attempts per 15 min = temporary lockout. */
export const twoFactorDisableLockout = createLoginLockout({ maxFailures: 5, windowMs: 15 * 60_000 });
