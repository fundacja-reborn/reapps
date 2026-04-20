<script lang="ts" module>
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from 'svelte';
	
	export interface CardContentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children?: Snippet;
	}
</script>

<script lang="ts">
	import { cn } from "../../utils/cn.js";

	let {
		class: className,
		children,
		...restProps
	}: CardContentProps = $props();
</script>

<div class={cn("p-6", className)} {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</div>
