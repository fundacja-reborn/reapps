// Re-export Toaster component for backward compatibility
export { default as Toaster } from "./toaster.svelte";

// Export empty components for backward compatibility (deprecated)
export { default as Toast } from "./toast.svelte";
export { default as ToastAction } from "./toast-action.svelte";
export { default as ToastClose } from "./toast-close.svelte";
export { default as ToastDescription } from "./toast-description.svelte";
export { default as ToastTitle } from "./toast-title.svelte";

// These component exports are kept for backward compatibility but are deprecated.
// Use svelte-sonner's toast function directly instead.
