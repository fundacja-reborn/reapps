<script lang="ts">
	import { Checkbox, Button, cn } from '@reborn/ui';
	import SubtaskTitleEditor from './SubtaskTitleEditor.svelte';
	import { Trash2, GripVertical } from '@lucide/svelte';
	import type { Subtask } from '@reborn/types';

	let {
		subtask,
		isEditing = false,
		isDeleting = false,
		disabled = false,
		isDragEnabled = false,
		onPointerDown,
		onPointerUp,
		onPointerCancel,
		onComplete,
		onTitleChange,
		onDelete,
		onEditStart,
		onEditEnd,
		class: className = ''
	} = $props<{
		subtask: Subtask;
		isEditing?: boolean;
		isDeleting?: boolean;
		disabled?: boolean;
		isDragEnabled?: boolean;
		onPointerDown?: (e: PointerEvent) => void;
		onPointerUp?: (e: PointerEvent) => void;
		onPointerCancel?: (e: PointerEvent) => void;
		onComplete?: (checked: boolean) => void;
		onTitleChange?: (title: string) => void;
		onDelete?: () => void;
		onEditStart?: () => void;
		onEditEnd?: () => void;
		class?: string;
	}>();

	let showDeleteButton = $state(false);

	function handleComplete(checked: boolean) {
		onComplete?.(checked);
	}

	async function handleTitleSave(newTitle: string) {
		if (newTitle.trim() && newTitle !== subtask.title) {
			onTitleChange?.(newTitle);
		}
	}

	function handleEditStart() {
		onEditStart?.();
	}

	function handleEditEnd() {
		onEditEnd?.();
	}

	function handleDelete() {
		if (!isDeleting) {
			onDelete?.();
		}
	}
</script>

<div
	role="group"
	class={cn(
		'group flex items-start gap-2 px-2 py-0 rounded-lg hover:bg-muted/50 transition-colors',
		isDragEnabled && 'bg-accent/20 shadow-sm',
		className
	)}
	onmouseenter={() => (showDeleteButton = true)}
	onmouseleave={() => (showDeleteButton = false)}
>
	<div class="pt-2">
		<Checkbox checked={subtask.is_completed} onCheckedChange={handleComplete} {disabled} />
	</div>

	<div class="flex-1 min-w-0 py-1.5">
		<SubtaskTitleEditor
			value={subtask.title}
			onValueChanged={handleTitleSave}
			onEditStart={handleEditStart}
			onEditEnd={handleEditEnd}
			{isEditing}
			{disabled}
			isCompleted={subtask.is_completed}
			placeholder="Subtask title"
			class="text-base"
		/>
	</div>

	<Button
		variant="ghost"
		size="icon"
		onclick={handleDelete}
		disabled={disabled || isDeleting}
		class={cn(
			'h-9 w-9 mt-0.5 shrink-0 opacity-0 [@media(hover:none)]:opacity-50 transition-opacity',
			showDeleteButton && 'opacity-100'
		)}
	>
		<Trash2 class="h-4 w-4" />
	</Button>

	<!-- Drag handle -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		data-drag-handle
		class={cn(
			'flex items-center justify-center min-h-10 min-w-8 mt-0.5 shrink-0 cursor-move transition-all touch-none',
			isDragEnabled
				? 'opacity-100 text-accent-foreground'
				: 'opacity-50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-50'
		)}
		aria-label="Drag to reorder"
		onpointerdown={onPointerDown}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
	>
		<GripVertical class="h-4 w-4" />
	</div>
</div>
