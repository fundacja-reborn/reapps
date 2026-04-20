import { createLogger } from '@reborn/utils';
import { toastStore } from '@reborn/ui';

const logger = createLogger('NotificationService');

export interface NotificationOptions {
	duration?: number;
	dismissable?: boolean;
	important?: boolean;
}

class NotificationService {
	/**
	 * Show success notification
	 */
	success(message: string, options?: NotificationOptions) {
		logger.info('Success notification:', message);
		
		toastStore.success(message, {
			duration: options?.duration ?? 3000,
		});
	}
	
	/**
	 * Show error notification
	 */
	error(message: string, error?: unknown, options?: NotificationOptions) {
		logger.error('Error notification:', message, error);
		
		// Log full error details
		if (error instanceof Error) {
			logger.error('Error details:', {
				message: error.message,
				stack: error.stack,
				name: error.name
			});
		}
		
		toastStore.error(message, {
			duration: options?.duration ?? 5000,
		});
	}
	
	/**
	 * Show warning notification
	 */
	warning(message: string, options?: NotificationOptions) {
		logger.warn('Warning notification:', message);
		
		toastStore.warning(message, {
			duration: options?.duration ?? 4000,
		});
	}
	
	/**
	 * Show info notification
	 */
	info(message: string, options?: NotificationOptions) {
		logger.info('Info notification:', message);
		
		toastStore.info(message, {
			duration: options?.duration ?? 3000,
		});
	}
	
	/**
	 * Show loading notification (returns a function to dismiss)
	 */
	loading(message: string): () => void {
		logger.info('Loading notification:', message);

		const id = toastStore.info(message, {
			duration: Infinity,
		});

		return () => {
			if (typeof id === 'string' || typeof id === 'number') {
				toastStore.remove(id);
			}
		};
	}

	/**
	 * Clear all notifications
	 */
	clearAll() {
		toastStore.dismissAll();
	}
}

// Export singleton
export const notificationService = new NotificationService();
