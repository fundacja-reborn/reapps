<!--
	@component
	Inline quick-add input for creating tasks with minimal data (title only).
	Used in TaskList (list views) and SidebarTaskList (filter views).
	Optional list selector for filter views where target list is ambiguous.
	Supports contextual metadata: section-aware auto-set of due_date, is_starred, etc.
-->
<script lang="ts">
	import { Plus, ArrowUp } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { t } from '$lib/stores/i18n.store';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import { toastStore } from '@reborn/ui';
	import { createLogger } from '@reborn/utils';
	import { activeLists, decryptedDefaultList } from '$lib/stores/decrypted-lists.store';
	import { Select, SelectTrigger, SelectContent, SelectItem } from '@reborn/ui';
	import type { Section } from '$lib/components/layout/IconNav.svelte';

	const logger = createLogger('QuickAddTask');

	let {
		listId = undefined,
		showListSelect = false,
		section = undefined,
		class: className = ''
	}: {
		listId?: string;
		showListSelect?: boolean;
		section?: Exclude<Section, 'lists'>;
		class?: string;
	} = $props();

	let title = $state('');
	let isCreating = $state(false);
	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let selectedListId = $state('');
	let isFocused = $state(false);
	let listSelectOpen = $state(false);
	let blurHideTimer: ReturnType<typeof setTimeout> | undefined;

	// Keep selectedListId in sync when listId prop changes, or default list loads
	$effect(() => {
		if (listId) {
			selectedListId = listId;
		} else if ($decryptedDefaultList) {
			selectedListId = $decryptedDefaultList.id;
		}
	});

	let effectiveListId = $derived(listId ?? selectedListId);

	// Contextual hint based on section
	let sectionHint = $derived.by(() => {
		switch (section) {
			case 'today':
				return $t('task.quick_add.hint_today');
			case 'starred':
				return $t('task.quick_add.hint_starred');
			case 'upcoming':
				return $t('task.quick_add.hint_upcoming');
			default:
				return '';
		}
	});

	// Show the list selector row while typing/focused, or while its dropdown is
	// open. Clicking into the dropdown blurs the textarea, so without the
	// listSelectOpen term the row would unmount mid-selection.
	let showListRow = $derived(
		showListSelect && (isFocused || title.length > 0 || listSelectOpen)
	);

	// Show the inline submit button (and reserve room for it) once there is text.
	let hasContent = $derived(title.trim().length > 0);

	export function focus() {
		inputEl?.focus();
		inputEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	function getTodayISO(): string {
		const now = Date.now();
		const d = new Date(now - (now % 86400000)); // midnight UTC
		return d.toISOString();
	}

	function getTomorrowISO(): string {
		const now = Date.now();
		const d = new Date(now - (now % 86400000) + 86400000); // tomorrow midnight UTC
		return d.toISOString();
	}

	function buildTaskData(trimmedTitle: string): Record<string, unknown> {
		const data: Record<string, unknown> = { title: trimmedTitle };

		switch (section) {
			case 'today':
				data.due_date = getTodayISO();
				data.has_time = false;
				break;
			case 'starred':
				data.is_starred = true;
				break;
			case 'upcoming':
				data.due_date = getTomorrowISO();
				data.has_time = false;
				break;
		}

		return data;
	}

	async function handleSubmit() {
		const trimmed = title.trim();
		if (!trimmed || isCreating) return;

		if (!effectiveListId) {
			toastStore.error($t('task.errors.create_failed'));
			return;
		}

		isCreating = true;
		try {
			const data = buildTaskData(trimmed);
			await taskOperationsService.createTask(data, effectiveListId);
			title = '';
			if (inputEl) {
				inputEl.style.height = 'auto';
			}
			toastStore.success($t('task.success.created'));
		} catch (error: unknown) {
			logger.error('Failed to create task:', error);
			toastStore.error($t('task.errors.create_failed'));
		} finally {
			isCreating = false;
		}
	}

	function autoResize() {
		if (!inputEl) return;
		inputEl.style.height = 'auto';
		inputEl.style.height = `${inputEl.scrollHeight}px`;
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		} else if (e.key === 'Escape') {
			title = '';
			if (inputEl) {
				inputEl.style.height = 'auto';
			}
			inputEl?.blur();
		}
	}

	function handleFocus() {
		// A refocus cancels any pending hide scheduled by a previous blur.
		if (blurHideTimer !== undefined) {
			clearTimeout(blurHideTimer);
			blurHideTimer = undefined;
		}
		isFocused = true;
	}

	function handleBlur() {
		// Defer hiding so a click landing on the list selector (or its open
		// dropdown) does not collapse the row mid-interaction. Keep the row while
		// the dropdown is open; the next genuine blur collapses it.
		if (blurHideTimer !== undefined) clearTimeout(blurHideTimer);
		blurHideTimer = setTimeout(() => {
			blurHideTimer = undefined;
			if (!listSelectOpen) isFocused = false;
		}, 200);
	}

	onDestroy(() => {
		if (blurHideTimer !== undefined) clearTimeout(blurHideTimer);
	});
</script>

<div class="flex flex-col gap-1.5 {className}">
	<div class="relative">
		<Plus
			class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
		/>
		<textarea
			bind:this={inputEl}
			bind:value={title}
			placeholder={$t('task.quick_add.placeholder')}
			onkeydown={handleKeyDown}
			oninput={autoResize}
			onfocus={handleFocus}
			onblur={handleBlur}
			disabled={isCreating}
			rows={1}
			class="block w-full resize-none overflow-hidden rounded-md border bg-background py-2 pl-9 text-sm placeholder:text-muted-foreground
				focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 {hasContent
				? 'pr-11'
				: 'pr-3'}"
		></textarea>
		{#if hasContent}
			<!-- Submit affordance for pointer/touch; keyboard users press Enter.
			     preventDefault on mousedown keeps the textarea focused through the click. -->
			<button
				type="button"
				onmousedown={(e) => e.preventDefault()}
				onclick={handleSubmit}
				disabled={isCreating}
				aria-label={$t('task.quick_add.submit')}
				title={$t('task.quick_add.submit')}
				class="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
			>
				<ArrowUp class="h-4 w-4" />
			</button>
		{/if}
	</div>

	{#if showListRow && $activeLists.length > 0}
		<div class="flex items-center gap-2 pl-1">
			<span class="text-xs text-muted-foreground shrink-0">{$t('task.quick_add.add_to_list')}</span>
			<Select
				type="single"
				bind:open={listSelectOpen}
				value={selectedListId}
				onValueChange={(v) => {
					selectedListId = v;
					// Hand focus back to the textarea so Enter creates the task
					// instead of reopening the selector. bits-ui restores focus to
					// the trigger on close, so defer past that.
					setTimeout(() => inputEl?.focus(), 0);
				}}
			>
				<SelectTrigger class="h-7 text-xs truncate flex-1 min-w-0">
					{$activeLists.find((l) => l.id === selectedListId)?.name ??
						$t('task.placeholders.list')}
				</SelectTrigger>
				<SelectContent>
					{#each $activeLists as list (list.id)}
						<SelectItem value={list.id}>{list.name}</SelectItem>
					{/each}
				</SelectContent>
			</Select>
		</div>
	{/if}

	{#if sectionHint && (isFocused || title.length > 0)}
		<p class="text-xs text-muted-foreground/70 pl-1">{sectionHint}</p>
	{/if}
</div>
