<script lang="ts">
	import { cn } from '@reborn/ui';
	import { createLogger } from '@reborn/utils';
	import { untrack } from 'svelte';

	const logger = createLogger('SubtaskTitleEditor');

	// Props
	let {
		value,
		disabled = false,
		isCompleted = false,
		isEditing = false,
		placeholder = '',
		onValueChanged,
		onEditStart,
		onEditEnd,
		class: className = ''
	} = $props<{
		value: string;
		disabled?: boolean;
		isCompleted?: boolean;
		isEditing?: boolean;
		placeholder?: string;
		onValueChanged?: (value: string) => void;
		onEditStart?: () => void;
		onEditEnd?: () => void;
		class?: string;
	}>();

	// State
	let internalIsEditing = $state(false);
	let effectiveIsEditing = $derived(isEditing !== undefined ? isEditing : internalIsEditing);
	let editValue = $state(untrack(() => value));
	let textarea = $state<HTMLTextAreaElement | null>(null);

	// Update textarea height to fit content
	function updateTextareaHeight(el: HTMLTextAreaElement | null) {
		if (!el) return;
		const scrollPos = window.scrollY;
		el.style.height = 'auto';
		el.style.height = el.scrollHeight + 'px';
		window.scrollTo(0, scrollPos);
	}

	// Update edit value when prop changes
	$effect(() => {
		if (!effectiveIsEditing) {
			editValue = value;
		}
	});

	// Handle external isEditing changes
	$effect(() => {
		if (isEditing && !internalIsEditing) {
			// External control requested editing
			editValue = value;

			// Focus textarea after DOM update and auto-resize
			requestAnimationFrame(() => {
				if (textarea) {
					textarea.focus();
					textarea.select();
					updateTextareaHeight(textarea);
				}
			});
		}
	});

	function startEdit() {
		if (disabled) return;

		logger.debug('Starting edit');

		// If controlled externally, emit event
		if (isEditing !== undefined) {
			onEditStart?.();
		} else {
			// Internal state management
			internalIsEditing = true;
		}

		editValue = value;

		// Focus textarea after DOM update and auto-resize
		requestAnimationFrame(() => {
			if (textarea) {
				textarea.focus();
				textarea.select();
				updateTextareaHeight(textarea);
			}
		});
	}

	function saveEdit() {
		const trimmedValue = editValue.trim();

		// Only save if value actually changed
		if (trimmedValue && trimmedValue !== value) {
			logger.debug('Saving edit', { oldValue: value, newValue: trimmedValue });
			onValueChanged?.(trimmedValue);
		}

		endEdit();
	}

	function cancelEdit() {
		logger.debug('Cancelling edit');
		editValue = value;
		endEdit();
	}

	function endEdit() {
		// If controlled externally, emit event
		if (isEditing !== undefined) {
			onEditEnd?.();
		} else {
			// Internal state management
			internalIsEditing = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	function handleInput(e: Event) {
		updateTextareaHeight(e.target as HTMLTextAreaElement);
	}

	function handleBlur() {
		// Save on blur
		saveEdit();
	}
</script>

{#if effectiveIsEditing}
	<textarea
		bind:this={textarea}
		bind:value={editValue}
		onblur={handleBlur}
		onkeydown={handleKeydown}
		oninput={handleInput}
		{disabled}
		{placeholder}
		rows="1"
		class={cn(
			'w-full resize-none overflow-hidden border-none bg-transparent p-0 focus:outline-none focus:ring-1 focus:ring-primary rounded',
			className
		)}
		aria-label="Edit subtask title"
	></textarea>
{:else}
	<button
		onclick={startEdit}
		{disabled}
		class={cn(
			'w-full text-left p-0 rounded transition-colors whitespace-normal break-words',
			'hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-primary',
			'disabled:cursor-not-allowed disabled:opacity-50',
			isCompleted && 'line-through text-muted-foreground',
			!value && 'text-muted-foreground italic',
			className
		)}
		aria-label="Click to edit subtask title"
	>
		{value || placeholder}
	</button>
{/if}
