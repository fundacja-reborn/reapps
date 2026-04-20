// Task components
export { default as TaskItem } from './TaskItem.svelte';
export { default as TaskList } from './TaskList.svelte';
export { default as QuickAddTask } from './QuickAddTask.svelte';
export { default as TaskTitleEditor } from './TaskTitleEditor.svelte';
export { default as TaskDescriptionEditor } from './TaskDescriptionEditor.svelte';
export { default as TaskProperties } from './TaskProperties.svelte';
export { default as TaskPropertyItem } from './TaskPropertyItem.svelte';
export { default as TaskSortButton } from './TaskSortButton.svelte';
export { default as TaskFilterBar } from './TaskFilterBar.svelte';
export type { TaskFilters, FilterOption } from '$lib/services/task-filtering.service';
export { default as RecurringInstancePanel } from './RecurringInstancePanel.svelte';
export { default as TaskSelectPlaceholder } from './TaskSelectPlaceholder.svelte';
export { default as FilterViewPlaceholder } from './FilterViewPlaceholder.svelte';

// Task dialogs
export * from './dialogs';
