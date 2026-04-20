<script lang="ts" module>
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from 'svelte';
	
	export interface CardTitleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children?: Snippet;
		level?: 1 | 2 | 3 | 4 | 5 | 6;
	}
</script>

<script lang="ts">
	import { cn } from "../../utils/cn.js";

	let {
		class: className,
		level = 3,
		children,
		...restProps
	}: CardTitleProps = $props();
</script>

<div
	role="heading"
	aria-level={level}
	class={cn("font-semibold leading-none tracking-tight", className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{/if}
</div>
