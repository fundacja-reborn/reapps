import { toast as sonnerToast } from 'svelte-sonner';

export type ToastVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info';

export interface ToastAction {
	label: string;
	onClick: () => void;
}

export interface Toast {
	id?: string | number;
	title?: string;
	description?: string;
	variant?: ToastVariant;
	action?: ToastAction;
	duration?: number;
}

// Wrapper around svelte-sonner for backward compatibility
export const toastStore = {
	success: (message: string, options?: Partial<Toast>) => {
		return sonnerToast.success(message, {
			description: options?.description,
			duration: options?.duration,
			action: options?.action ? {
				label: options.action.label,
				onClick: options.action.onClick,
			} : undefined,
		});
	},
	error: (message: string, options?: Partial<Toast>) => {
		return sonnerToast.error(message, {
			description: options?.description,
			duration: options?.duration,
			action: options?.action ? {
				label: options.action.label,
				onClick: options.action.onClick,
			} : undefined,
		});
	},
	info: (message: string, options?: Partial<Toast>) => {
		return sonnerToast.info(message, {
			description: options?.description,
			duration: options?.duration,
			action: options?.action ? {
				label: options.action.label,
				onClick: options.action.onClick,
			} : undefined,
		});
	},
	warning: (message: string, options?: Partial<Toast>) => {
		return sonnerToast.warning(message, {
			description: options?.description,
			duration: options?.duration,
			action: options?.action ? {
				label: options.action.label,
				onClick: options.action.onClick,
			} : undefined,
		});
	},
	custom: (options: Toast) => {
		return sonnerToast(options.title || '', {
			description: options.description,
			duration: options.duration,
			action: options.action ? {
				label: options.action.label,
				onClick: options.action.onClick,
			} : undefined,
		});
	},
	remove: (id: string | number) => {
		sonnerToast.dismiss(id);
	},
	dismissAll: () => {
		sonnerToast.dismiss();
	}
};

// Export the original toast function for direct access
export { toast } from 'svelte-sonner';