<script lang="ts">
	import { cn } from '../../utils/cn';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className = '',
		children,
		...restProps
	} = $props<HTMLAttributes<HTMLSpanElement> & {
		children?: any;
	}>();
</script>

<span
	role="link"
	aria-disabled="true"
	aria-current="page"
	class={cn('font-normal text-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</span>
