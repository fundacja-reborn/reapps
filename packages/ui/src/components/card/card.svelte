<script lang="ts">
	import { cn } from "../../utils/cn.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from 'svelte';
	
	interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children?: Snippet;
	}

	let {
		class: className,
		children,
		...restProps
	}: CardProps = $props();
</script>

<div
	class={cn("bg-card text-card-foreground rounded-xl border shadow", className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</div>
