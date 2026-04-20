<script lang="ts">
	import { ChevronRight, type Icon as LucideIconType } from '@lucide/svelte';
	import { cn } from "../../utils/cn";// poprawiony import
	import { Button } from '@reborn/ui';

	let {
		href,
		title,
		description,
		icon: Icon,
		class: className
	} = $props<{
		href: string;
		title: string;
		description?: string;
		icon: typeof LucideIconType;
		class?: string;
	}>();
</script>

<a
	{href}
	class={cn(
		'flex items-center justify-between px-4 py-4 transition-colors hover:bg-muted/50 active:bg-muted/70 -mx-4 sm:rounded-lg sm:mx-0',
		className
	)}
>
	<div class="flex items-center gap-3">
		<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
			<Icon class="h-5 w-5 text-muted-foreground" />
		</div>
		<div class="flex flex-col">
			<div class="text-sm font-medium leading-none">{title}</div>
			{#if description}
				<div class="text-sm text-muted-foreground mt-1">{description}</div>
			{/if}
		</div>
	</div>
	<ChevronRight class="h-5 w-5 text-muted-foreground" />
</a>

