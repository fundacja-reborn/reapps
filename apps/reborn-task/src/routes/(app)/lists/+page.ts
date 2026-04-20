import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { authGuard } from '$lib/guards/auth';

export const ssr = false;

export const load: PageLoad = async ({ url, parent }) => {
	await parent();

	if (browser) {
		const allowed = await authGuard({
			requireE2E: true,
			returnTo: url.pathname + url.search
		});

		if (!allowed) {
			return { redirecting: true };
		}
	}

	return {};
};
