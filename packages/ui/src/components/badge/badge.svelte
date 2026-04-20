<script lang="ts">
	import { cn } from '../../utils/cn';
	import { badgeVariants, type BadgeVariant } from './variants';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className = '',
		variant = 'default',
		children,
		...restProps
	} = $props<HTMLAttributes<HTMLDivElement> & {
		variant?: BadgeVariant;
		children?: any;
	}>();
</script>

<div
	class={cn(
		badgeVariants({ variant }),
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
