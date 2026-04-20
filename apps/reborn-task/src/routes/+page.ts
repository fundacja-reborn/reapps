import type { PageLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { base } from '$app/paths';

export const load: PageLoad = async ({ parent }) => {
	// Wait for parent layout to complete
	await parent();

	// Client-side only redirect
	if (browser) {
		// Quick check for auth tokens
		// Refresh token is in httpOnly cookie (not accessible from JS)
		const hasTokens = !!localStorage.getItem('access_token');

		if (hasTokens) {
			// Authenticated — redirect to "All tasks" view
			redirect(303, `${base}/all`);
		} else {
			// No tokens, redirect to login
			redirect(303, `${base}/auth/login`);
		}
	}

	// Server-side: just return empty object
	// The client will handle the redirect
	return {};
};
