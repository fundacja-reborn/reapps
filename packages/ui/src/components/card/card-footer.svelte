<script lang="ts" module>
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from 'svelte';
	
	export interface CardFooterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children?: Snippet;
	}
</script>

<script lang="ts">
	import { cn } from "../../utils/cn.js";

	let {
		class: className,
		children,
		...restProps
	}: CardFooterProps = $props();
</script>

<div class={cn("flex items-center p-6 pt-0", className)} {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</div>
