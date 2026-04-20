<script lang="ts">
	import { Toaster as Sonner } from "svelte-sonner";
	
	// Re-export as Toaster for backward compatibility
</script>

<Sonner
	richColors
	theme="light"
	position="bottom-right"
	class="toaster group"
	toastOptions={{
		classes: {
			toast:
				"group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg rounded-md",
			description: "group-[.toast]:text-muted-foreground",
			actionButton:
				"group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
			cancelButton:
				"group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
			error: "group-[.toaster]:bg-destructive group-[.toaster]:text-destructive-foreground group-[.toaster]:border-destructive",
			success: "group-[.toaster]:bg-green-50 group-[.toaster]:text-green-900 group-[.toaster]:border-green-200",
			warning: "group-[.toaster]:bg-yellow-50 group-[.toaster]:text-yellow-900 group-[.toaster]:border-yellow-200",
			info: "group-[.toaster]:bg-blue-50 group-[.toaster]:text-blue-900 group-[.toaster]:border-blue-200",
		},
	}}
/>