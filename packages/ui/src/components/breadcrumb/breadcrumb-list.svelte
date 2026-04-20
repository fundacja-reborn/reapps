<script lang="ts">
	import { cn } from '../../utils/cn';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className = '',
		children,
		...restProps
	} = $props<HTMLAttributes<HTMLOListElement> & {
		children?: any;
	}>();
</script>

<ol
	class={cn(
		'flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</ol>
