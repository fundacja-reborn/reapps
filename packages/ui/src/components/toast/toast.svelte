<!-- Deprecated: Use svelte-sonner instead -->
<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	
	export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
		variant?: 'default' | 'destructive';
	}
	
	let { variant = 'default', ...restProps }: ToastProps = $props();
</script>

<!-- Empty component for backward compatibility -->