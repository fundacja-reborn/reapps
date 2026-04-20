<!-- Deprecated: Use svelte-sonner instead -->
<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	
	export interface ToastTitleProps extends HTMLAttributes<HTMLHeadingElement> {}
	
	let props: ToastTitleProps = $props();
</script>

<!-- Empty component for backward compatibility -->