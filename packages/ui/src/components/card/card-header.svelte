<script lang="ts" module>
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from 'svelte';
	
	export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children?: Snippet;
	}
</script>

<script lang="ts">
	import { cn } from "../../utils/cn.js";

	let {
		class: className,
		children,
		...restProps
	}: CardHeaderProps = $props();
</script>

<div class={cn("flex flex-col space-y-1.5 p-6 pb-0", className)} {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</div>
