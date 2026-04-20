import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { authGuard } from '$lib/guards/auth';

// Disable SSR for authenticated pages
export const ssr = false;

export const load: PageLoad = async ({ url, parent, params }) => {
	// Wait for parent layout to complete
	await parent();
	
	// Check auth and E2E status
	if (browser) {
		const allowed = await authGuard({
			requireE2E: true,
			returnTo: url.pathname + url.search
		});
		
		// If auth guard redirected, return with flag
		if (!allowed) {
			return {
				listId: params.listId,
				redirecting: true
			};
		}
	}

	// Return data for the page
	return {
		listId: params.listId
	};
};
