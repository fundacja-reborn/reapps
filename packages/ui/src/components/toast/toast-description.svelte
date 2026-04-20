<!-- Deprecated: Use svelte-sonner instead -->
<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	
	export interface ToastDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {}
	
	let props: ToastDescriptionProps = $props();
</script>

<!-- Empty component for backward compatibility -->