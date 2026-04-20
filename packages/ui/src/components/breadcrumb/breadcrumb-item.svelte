<script lang="ts">
	import { cn } from '../../utils/cn';
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
	class={cn('inline-flex items-center gap-1.5', className)}
	{...restProps}
>
	{@render children?.()}
</li>
