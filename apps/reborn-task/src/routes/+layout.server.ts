import type { LayoutServerLoad } from './$types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('LayoutServer');

export const load: LayoutServerLoad = async () => {
	// Server-side auth checks disabled for offline-first architecture
	// Auth is handled on the client side
	// This prevents redirect loops and allows the app to work offline
	
	logger.debug('Layout server load called');
	
	return {
		user: null // Will be populated by client-side session management
	};
};
