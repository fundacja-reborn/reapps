<script lang="ts">
	import { cn } from '../../utils/cn';
	import type { HTMLAnchorAttributes } from 'svelte/elements';

	let {
		class: className = '',
		children,
		...restProps
	} = $props<HTMLAnchorAttributes & {
		children?: any;
	}>();
</script>

<a
	class={cn('transition-colors hover:text-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</a>
