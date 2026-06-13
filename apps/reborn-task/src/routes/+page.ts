import type { PageLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { base } from '$app/paths';
import { authOperationsService } from '$lib/services/auth-operations.service';
import { LOCAL_MODE_KEY } from '$lib/stores/local-mode.store';

async function waitForSessionReady(timeoutMs = 1500) {
	const sessionManager = authOperationsService.getSessionManager();
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		const current = sessionManager.getCurrentSession();
		if (current.isInitialized && !current.isLoading) {
			return current;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	return sessionManager.getCurrentSession();
}

export const load: PageLoad = async ({ parent }) => {
	// Wait for parent layout to complete
	await parent();

	// Client-side only redirect
	if (browser) {
		// NOTE: `redirect()` throws a `Redirect` sentinel that SvelteKit catches
		// upstream — it MUST NOT be wrapped in try/catch here or the happy path
		// gets swallowed and every visit falls through to /auth/unlock.

		// Offline cold start: decide the redirect target from persisted
		// credentials directly. The session store may still be mid-bootstrap
		// at this point (checkE2EStatus can take 5s+ waiting on the crypto
		// manager's IndexedDB restore), and using waitForSessionReady() would
		// race setAuthenticated() — producing the classic offline symptom
		// "/ → /auth/login" even though valid credentials are on disk.
		if (!navigator.onLine) {
			const hasCredentials = !!localStorage.getItem('reborn_auth_credentials');
			const isLocalOnly = localStorage.getItem(LOCAL_MODE_KEY) === '1';
			if (!hasCredentials && !isLocalOnly) {
				redirect(303, `${base}/auth/login`);
			}
			const { cryptoManager } = await import('@reborn/crypto');
			await cryptoManager.waitForRestore();
			// Local-only mode has no unlock page: the key lives at-rest in IndexedDB,
			// so a restored key means straight to the app.
			redirect(
				303,
				cryptoManager.isInitialized()
					? `${base}/all`
					: isLocalOnly
						? `${base}/auth/login`
						: `${base}/auth/unlock`
			);
		}

		let currentSession: Awaited<ReturnType<typeof waitForSessionReady>>;
		try {
			currentSession = await waitForSessionReady();
		} catch {
			const hasTokens = !!localStorage.getItem('access_token');
			redirect(303, hasTokens ? `${base}/auth/unlock` : `${base}/auth/login`);
		}

		if (currentSession.isAuthenticated) {
			redirect(303, currentSession.hasE2E ? `${base}/all` : `${base}/auth/unlock`);
		}

		// Local-only / no-account mode is a usable state - send it into the app.
		if (currentSession.isLocalOnly) {
			redirect(303, `${base}/all`);
		}

		redirect(303, `${base}/auth/login`);
	}

	// Server-side: just return empty object
	// The client will handle the redirect
	return {};
};
