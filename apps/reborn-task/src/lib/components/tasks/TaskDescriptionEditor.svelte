<script lang="ts">
	import { createLogger } from '@reborn/utils';
	import { cn } from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';

	const logger = createLogger('TaskDescriptionEditor');

	// Props
	let {
		value,
		disabled = false,
		placeholder,
		onValueChanged,
		class: className = ''
	} = $props<{
		value: string;
		disabled?: boolean;
		placeholder?: string;
		onValueChanged?: (value: string) => void;
		class?: string;
	}>();

	// State
	let textarea = $state<HTMLTextAreaElement | null>(null);

	// Update textarea height to fit content
	function updateTextareaHeight(textareaElement: HTMLTextAreaElement | null) {
		if (!textareaElement) return;

		// Save current scroll position
		const scrollPos = window.scrollY;

		// Reset height and set new height based on scroll height
		textareaElement.style.height = 'auto';
		const scrollHeight = textareaElement.scrollHeight;
		textareaElement.style.height = scrollHeight + 'px';

		// Restore scroll position
		window.scrollTo(0, scrollPos);
	}

	function handleInput(e: Event) {
		const textareaElement = e.target as HTMLTextAreaElement;
		updateTextareaHeight(textareaElement);

		// Only dispatch if value changed
		if (textareaElement.value !== value) {
			logger.debug('Description changed, dispatching valueChanged event');
			onValueChanged?.(textareaElement.value);
		}
	}

	function handleFocus(e: FocusEvent) {
		// Prevent scroll jumping on focus
		e.preventDefault();

		// Prevent scroll restoration
		if (e.target instanceof HTMLElement) {
			e.target.style.scrollMarginTop = '0';
		}
	}

	// Initialize height after mount
	$effect(() => {
		if (textarea) {
			// Wait for next tick for DOM to update
			setTimeout(() => {
				updateTextareaHeight(textarea);
			}, 0);
		}
	});
</script>

<div class="relative">
	<textarea
		bind:this={textarea}
		{value}
		oninput={handleInput}
		placeholder={placeholder || $t('task.fields.description')}
		{disabled}
		class={cn(
			'w-full resize-none scroll-mt-0 overflow-hidden border-none bg-transparent p-0',
			'placeholder:text-muted-foreground focus:outline-none focus:ring-0',
			'text-sm',
			className
		)}
		rows="1"
		onfocus={handleFocus}
		aria-label="Task description"
	></textarea>
</div>
