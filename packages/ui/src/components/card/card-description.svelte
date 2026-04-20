<script lang="ts" module>
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from 'svelte';
	
	export interface CardDescriptionProps extends Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> {
		children?: Snippet;
	}
</script>

<script lang="ts">
	import { cn } from "../../utils/cn.js";

	let {
		class: className,
		children,
		...restProps
	}: CardDescriptionProps = $props();
</script>

<p class={cn("text-muted-foreground text-sm", className)} {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</p>
