<script lang="ts">
	import { Button, cn } from '@reborn/ui';
	import { Plus, Check, X } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';

	let {
		disabled = false,
		placeholder = '',
		onAdd,
		class: className = ''
	} = $props<{
		disabled?: boolean;
		placeholder?: string;
		onAdd?: (title: string) => void;
		class?: string;
	}>();

	let isAdding = $state(false);
	let newSubtaskTitle = $state('');
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	// Update textarea height to fit content
	function updateTextareaHeight(el: HTMLTextAreaElement | null) {
		if (!el) return;
		const scrollPos = window.scrollY;
		el.style.height = 'auto';
		el.style.height = el.scrollHeight + 'px';
		window.scrollTo(0, scrollPos);
	}

	function startAdding() {
		isAdding = true;
		newSubtaskTitle = '';

		// Focus textarea after DOM update
		requestAnimationFrame(() => {
			if (textareaEl) {
				textareaEl.focus();
				updateTextareaHeight(textareaEl);
			}
		});
	}

	function cancelAdding() {
		isAdding = false;
		newSubtaskTitle = '';
	}

	function handleAdd() {
		if (newSubtaskTitle.trim()) {
			onAdd?.(newSubtaskTitle.trim());
			newSubtaskTitle = '';

			// Reset height and keep focused for adding multiple subtasks
			requestAnimationFrame(() => {
				if (textareaEl) {
					textareaEl.style.height = 'auto';
					textareaEl.focus();
				}
			});
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleAdd();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelAdding();
		}
	}

	function handleInput(e: Event) {
		updateTextareaHeight(e.target as HTMLTextAreaElement);
	}
</script>

<div class={cn('relative', className)}>
	{#if isAdding}
		<div class="flex items-start gap-1.5">
			<textarea
				bind:this={textareaEl}
				bind:value={newSubtaskTitle}
				onkeydown={handleKeydown}
				oninput={handleInput}
				onblur={() => {
					// Small delay to allow click on add button
					setTimeout(() => {
						if (!newSubtaskTitle.trim()) {
							cancelAdding();
						}
					}, 200);
				}}
				{placeholder}
				{disabled}
				rows="1"
				class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full flex-1 resize-none overflow-hidden rounded-md border px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
			></textarea>
			<Button
				size="icon"
				variant="ghost"
				onclick={handleAdd}
				disabled={disabled || !newSubtaskTitle.trim()}
				aria-label={$t('task.subtasks.add_aria')}
				class="h-8 w-8 mt-1 shrink-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950/20 disabled:opacity-30"
			>
				<Check class="h-4 w-4" />
			</Button>
			<Button
				size="icon"
				variant="ghost"
				onclick={cancelAdding}
				{disabled}
				aria-label={$t('task.subtasks.cancel_aria')}
				class="h-8 w-8 mt-1 shrink-0 text-muted-foreground hover:text-foreground"
			>
				<X class="h-4 w-4" />
			</Button>
		</div>
	{:else}
		<Button
			variant="ghost"
			size="sm"
			onclick={startAdding}
			{disabled}
			class="w-full justify-start text-muted-foreground h-auto px-2 py-1"
		>
			<Plus class="h-4 w-4 mr-2" />
			{placeholder || $t('task.subtasks.add')}
		</Button>
	{/if}
</div>
