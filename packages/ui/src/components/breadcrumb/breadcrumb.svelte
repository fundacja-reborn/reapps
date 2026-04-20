<script lang="ts">
	import { cn } from '../../utils/cn';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className = '',
		children,
		...restProps
	} = $props<HTMLAttributes<HTMLElement> & {
		children?: any;
	}>();
</script>

<nav
	aria-label="Breadcrumb"
	class={cn('', className)}
	{...restProps}
>
	{@render children?.()}
</nav>
