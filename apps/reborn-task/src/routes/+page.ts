import type { PageLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { base } from '$app/paths';
import { authOperationsService } from '$lib/services/auth-operations.service';

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

		redirect(303, `${base}/auth/login`);
	}

	// Server-side: just return empty object
	// The client will handle the redirect
	return {};
};
