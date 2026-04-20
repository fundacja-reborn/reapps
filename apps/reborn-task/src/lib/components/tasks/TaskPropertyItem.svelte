<script lang="ts">
	import { Button, cn } from '@reborn/ui';
	import { X } from '@lucide/svelte';

	// Props
	let {
		icon: Icon,
		value = '',
		placeholder = '',
		hasValue = false,
		onclick,
		onremove,
		disabled = false,
		class: className = ''
	} = $props<{
		icon: typeof X;
		value?: string;
		placeholder?: string;
		hasValue?: boolean;
		onclick: () => void;
		onremove?: () => void;
		disabled?: boolean;
		class?: string;
	}>();
</script>

<div class={cn('flex items-center gap-2', className)}>
	<button
		type="button"
		{onclick}
		{disabled}
		class={cn(
			'flex items-center gap-2 text-base',
			'hover:bg-muted rounded px-2 py-2 transition-colors',
			'disabled:opacity-50 disabled:cursor-not-allowed',
			!hasValue && 'text-muted-foreground'
		)}
	>
		<Icon class="h-4 w-4" />
		<span>{hasValue ? value : placeholder}</span>
	</button>

	{#if hasValue && onremove}
		<Button
			variant="ghost"
			size="icon"
			onclick={onremove}
			{disabled}
			class="h-9 w-9"
			aria-label="Remove"
		>
			<X class="h-3.5 w-3.5" />
		</Button>
	{/if}
</div>
