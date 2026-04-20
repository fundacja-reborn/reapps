<script lang="ts">
	import * as Dialog from '@reborn/ui/components/dialog';
	import { Button, Input, Label } from '@reborn/ui';
	import { Edit } from '@lucide/svelte';
	import type { ListDecrypted } from '@reborn/types';
	import { t } from '$lib/stores/i18n.store';
	import { MAX_LIST_NAME_LENGTH } from '$lib/services/list-operations.service';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:edit-list-name');

	let {
		open = $bindable(false),
		list,
		onSave,
		onClose
	} = $props<{
		open: boolean;
		list: ListDecrypted | null;
		onSave: (name: string) => Promise<void>;
		onClose: () => void;
	}>();

	// Form state
	let name = $state('');
	let isSaving = $state(false);
	let inputElement = $state<HTMLInputElement | null>(null);

	// Character count
	let charCount = $derived(name.length);
	let isValid = $derived(name.trim().length > 0 && name.length <= MAX_LIST_NAME_LENGTH);

	// Reset form when dialog opens
	$effect(() => {
		if (open && list) {
			name = list.name;
			// Focus input after a tick
			setTimeout(() => inputElement?.focus(), 50);
		}
	});

	async function handleSave() {
		if (!isValid || !list) return;

		isSaving = true;
		try {
			await onSave(name.trim());
			onClose();
		} catch (error: unknown) {
			logger.error('Failed to save list name:', error);
			// Error is handled by parent component
		} finally {
			isSaving = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && isValid) {
			e.preventDefault();
			handleSave();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			handleClose();
		}
	}

	function handleClose() {
		onClose();
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={(isOpen) => {
		if (!isOpen) onClose();
	}}
>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{$t('taskList.edit_dialog.title')}
			</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<Label for="list-name">{$t('taskList.name')}</Label>
				<div class="relative">
					<Input
						id="list-name"
						bind:value={name}
						bind:ref={inputElement}
						onkeydown={handleKeydown}
						placeholder={$t('taskList.edit_dialog.placeholder')}
						maxlength={MAX_LIST_NAME_LENGTH}
						class="pr-12 h-11 text-base {!isValid && name.length > 0
							? 'border-destructive focus:ring-destructive'
							: ''}"
					/>
					<div class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
						{charCount}/{MAX_LIST_NAME_LENGTH}
					</div>
				</div>
				{#if name.length > 0 && !isValid}
					<p class="text-sm text-destructive">
						{#if name.trim().length === 0}
							{$t('taskList.edit_dialog.error_empty')}
						{:else if name.length > MAX_LIST_NAME_LENGTH}
							{$t('taskList.edit_dialog.error_too_long')}
						{/if}
					</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={handleClose} disabled={isSaving}>
				{$t('common.cancel')}
			</Button>
			<Button onclick={handleSave} disabled={!isValid || isSaving}>
				{#if isSaving}
					<span class="flex items-center gap-2">
						<span
							class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
						></span>
						{$t('common.saving')}
					</span>
				{:else}
					{$t('common.save')}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
