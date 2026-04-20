<script lang="ts">
	import { cn } from '../../utils/cn';
	import { ChevronRight } from '@lucide/svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className = '',
		children,
		...restProps
	} = $props<HTMLAttributes<HTMLLIElement> & {
		children?: any;
	}>();
</script>

<li
	role="presentation"
	aria-hidden="true"
	class={cn('[&>svg]:size-3.5', className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		<ChevronRight />
	{/if}
</li>
