<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { onMount, type Snippet } from 'svelte';
	import {
		SidebarProvider,
		Sidebar,
		SidebarHeader,
		SidebarContent,
		SidebarInset,
		Button,
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter,
		Select,
		SelectTrigger,
		SelectContent,
		SelectItem
	} from '@reborn/ui';
	import * as Tooltip from '@reborn/ui/components/tooltip';
	import IconNav, { type Section } from '$lib/components/layout/IconNav.svelte';
	import SidebarTaskList from '$lib/components/layout/sidebar/SidebarTaskList.svelte';
	import TaskListsPanel from '$lib/components/layout/sidebar/TaskListsPanel.svelte';
	import SyncStatusFooter from '$lib/components/sync/SyncStatusFooter.svelte';
	import {
		AppHeader,
		DefaultHeader,
		TaskListHeaderContent,
		TaskDetailHeaderContent,
		StarredHeaderContent,
		CompletedHeaderContent,
		TrashHeader,
		FilterViewHeaderContent
	} from '$lib/components/layout';
	import { CreateListSheet, DeleteListDialog, EditListNameModal, TaskListSheet } from '$lib/components/task-list';
	import { DeleteTaskDialog, TaskList, TaskFilterBar } from '$lib/components/tasks';
	import { TaskSelectPlaceholder, FilterViewPlaceholder } from '$lib/components/tasks';
	import { page } from '$app/stores';
	import { goto } from '$lib/utils/navigation';
	import { session } from '$lib/stores/auth.store';
	import { t } from '$lib/stores/i18n.store';
	import { activeLists, taskListStore } from '$lib/stores/decrypted-lists.store';
	import { listOperationsService } from '$lib/services/list-operations.service';
	import { activeListStore } from '$lib/stores/active-list.store';
	import { isOnline } from '$lib/stores/network.store';
	import { toastStore } from '@reborn/ui';
	import { untrack, tick } from 'svelte';
	import { cryptoManager } from '@reborn/crypto';
	import { Lock, WifiOff, RefreshCw } from '@lucide/svelte';
	import { offlineOperationsStore } from '$lib/stores/offline-operations.store';
	import { addOperation } from '@reborn/storage';
	import { theme } from '$lib/stores/theme.store';
	import { taskCounts } from '$lib/stores/task-counts.store';
	import { taskStore } from '@reborn/storage';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import { syncConflict } from '$lib/services/sync.service';
	import { layoutStore } from '$lib/stores/layout.store';
	import { taskListView } from '$lib/stores/task-list-view.store';
	import { onDestroy } from 'svelte';
	import type { ListDecrypted, TaskDecrypted } from '@reborn/types';
	import type { TaskFilters } from '$lib/services/task-filtering.service';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:app-layout');

	let selectedListId = $state<string | null>(null);
	let isLoading = $state(true);
	let isCreating = $state(false);
	let moveTargetListId = $state<string>('');
	let needsOnlineSetup = $state(false);
	let isRetryingSetup = $state(false);

	// ── Mobile view state (Panel 1 content) ──────────────────────
	type MobileView = 'sidebar' | 'tasks';
	let mobileView = $state<MobileView>('sidebar');
	let mobileTaskFilters = $state<TaskFilters>({ option: 'all' });
	let mobileMenuOpen = $state(false);

	// ── Icon Rail section ─────────────────────────────────────────
	let activeSection = $state<Section>($layoutStore.activeSection);
	let searchFocusRequested = $state(false);

	// Sync activeSection to layoutStore + reset mobileView + navigate
	$effect(() => {
		const section = activeSection;
		layoutStore.setSection(section);

		const sectionRouteMap: Partial<Record<Section, string>> = {
			all: '/all',
			lists: '/lists',
			starred: '/starred',
			overdue: '/overdue',
			today: '/today',
			upcoming: '/upcoming',
			no_date: '/no-date',
			trash: '/trash'
		};

		if (isMobile) {
			mobileView = 'sidebar';
			mobileTaskFilters = { option: 'all' };
			// Mobile: also update the URL so refresh stays on the correct page
			if (browser) {
				const targetRoute = sectionRouteMap[section];
				if (targetRoute) {
					const currentPath = untrack(() => $page.url.pathname);
					if (currentPath !== targetRoute) {
						goto(targetRoute, { replaceState: true });
					}
				}
			}
		} else if (browser) {
			// Desktop: navigate to the corresponding route for filter sections
			const targetRoute = sectionRouteMap[section];
			if (targetRoute) {
				// untrack $page to avoid circular dependency with route→section sync
				const currentPath = untrack(() => $page.url.pathname);
				if (currentPath !== targetRoute) {
					goto(targetRoute);
				}
			}
		}
	});

	// ── Mobile detection ──────────────────────────────────────────
	let isMobile = $state(false);

	onMount(() => {
		const mq = window.matchMedia('(max-width: 767px)');
		isMobile = mq.matches;
		const handler = (e: MediaQueryListEvent) => {
			isMobile = e.matches;
		};
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	});

	// ── Mobile swipe-back gesture ─────────────────────────────────
	let swipeStartX = 0;
	let swipeStartY = 0;
	let swiping = false;

	function handleSwipeStart(e: TouchEvent) {
		const touch = e.touches[0];
		if (touch.clientX < 30) {
			swipeStartX = touch.clientX;
			swipeStartY = touch.clientY;
			swiping = true;
		}
	}

	function handleSwipeEnd(e: TouchEvent) {
		if (!swiping) return;
		swiping = false;
		const dx = e.changedTouches[0].clientX - swipeStartX;
		const dy = Math.abs(e.changedTouches[0].clientY - swipeStartY);
		if (dx > 80 && dy < 50) {
			// Swipe right → go back to master panel
			if (showDetail) {
				handleMobileBack();
			}
		}
	}

	// ── Quick-add focus ──────────────────────────────────────────

	let sidebarTaskListRef = $state<SidebarTaskList | undefined>(undefined);
	let mobileTaskListRef = $state<TaskList | undefined>(undefined);
	let filterViewPlaceholderRef = $state<FilterViewPlaceholder | undefined>(undefined);

	async function handleNewTask() {
		if (activeSection === 'lists') {
			if (isMobile) {
				if (mobileView === 'tasks' && mobileTaskListRef) {
					// Already viewing a task list — just focus quick-add
					mobileTaskListRef.focusQuickAdd();
				} else {
					// Viewing list catalog (sidebar) — navigate to default list + focus
					const defaultList = $activeLists.find((l) => l.is_default) ?? $activeLists[0];
					if (defaultList) {
						await handleNavigateToList(defaultList.id);
						await tick();
						mobileTaskListRef?.focusQuickAdd();
					}
				}
			} else if (isTaskPage) {
				// Desktop: task detail is open — navigate back to list, then focus quick-add
				const targetListId =
					selectedListId && !['starred', 'completed', 'trash'].includes(selectedListId)
						? selectedListId
						: currentTask?.task_list_id ??
							($activeLists.find((l) => l.is_default) ?? $activeLists[0])?.id;
				if (targetListId) {
					await goto(`/lists/${targetListId}`);
					await tick();
					window.dispatchEvent(new CustomEvent('focus-quick-add'));
				}
			} else {
				// Desktop: TaskList is on the page, dispatch custom event
				window.dispatchEvent(new CustomEvent('focus-quick-add'));
			}
		} else if (activeSection === 'trash' || activeSection === 'overdue') {
			// Trash/Overdue — navigate to default list, then focus
			const defaultList = $activeLists.find((l) => l.is_default) ?? $activeLists[0];
			if (defaultList) {
				await handleNavigateToList(defaultList.id);
				await tick();
				if (isMobile) {
					mobileTaskListRef?.focusQuickAdd();
				} else {
					window.dispatchEvent(new CustomEvent('focus-quick-add'));
				}
			}
		} else {
			// Filter view — focus quick-add
			if (isMobile) {
				sidebarTaskListRef?.focusQuickAdd();
			} else if (isTaskPage) {
				// Desktop: task detail is open — navigate back to filter route, then focus quick-add
				const sectionRouteMap: Partial<Record<Section, string>> = {
					all: '/all',
					starred: '/starred',
					today: '/today',
					upcoming: '/upcoming',
					no_date: '/no-date'
				};
				const target = sectionRouteMap[activeSection] ?? '/all';
				await goto(target);
				await tick();
				filterViewPlaceholderRef?.focusQuickAdd();
			} else {
				// Desktop: quick-add is in FilterViewPlaceholder (main panel)
				filterViewPlaceholderRef?.focusQuickAdd();
			}
		}
	}

	// ── Mobile: determine if detail panel (Panel 2) should show ───
	// Only task detail and non-list routes show Panel 2.
	// List views are rendered inside Panel 1 via mobileView='tasks'.
	let showDetail = $derived.by(() => {
		const routeId = $page.route.id;
		if (!routeId) return false;
		if (routeId.includes('/tasks/')) return true;
		if (routeId.includes('/settings')) return true;
		return false;
	});

	// Desktop: show placeholder instead of route content for filter views
	// (task list is already rendered in sidebar)
	// Use $page.route.id (base-path agnostic) instead of $page.url.pathname
	const FILTER_ROUTE_IDS = [
		'/(app)/all',
		'/(app)/today',
		'/(app)/starred',
		'/(app)/overdue',
		'/(app)/upcoming',
		'/(app)/no-date',
		'/(app)/completed',
		'/(app)/trash'
	];
	let showDesktopPlaceholder = $derived.by(() => {
		if (isMobile) return false;
		const routeId = $page.route.id ?? '';
		return FILTER_ROUTE_IDS.includes(routeId);
	});

	// Task page state
	let currentTaskId = $derived($page.params.taskId);
	let currentTask = $state<TaskDecrypted | null>(null);
	let isTaskPage = $derived(!!currentTaskId);

	// Current list for header
	let currentList = $derived(
		isTaskPage && currentTask
			? $activeLists.find((list) => list.id === currentTask?.task_list_id) || null
			: selectedListId &&
				  selectedListId !== 'starred' &&
				  selectedListId !== 'completed' &&
				  selectedListId !== 'trash'
				? $activeLists.find((list) => list.id === selectedListId) || null
				: null
	);

	// Determine which header component to render
	let headerComponent = $derived.by(() => {
		const routeId = $page.route.id ?? '';
		if (routeId.includes('/tasks/')) return TaskDetailHeaderContent;
		if (routeId.includes('/starred')) return StarredHeaderContent;
		if (routeId.includes('/completed')) return CompletedHeaderContent;
		if (routeId.includes('/trash')) return TrashHeader;
		if (routeId.includes('/lists/')) return TaskListHeaderContent;
		// Filter view routes
		if (routeId.includes('/all')) return FilterViewHeaderContent;
		if (routeId.includes('/today')) return FilterViewHeaderContent;
		if (routeId.includes('/overdue')) return FilterViewHeaderContent;
		if (routeId.includes('/upcoming')) return FilterViewHeaderContent;
		if (routeId.includes('/no-date')) return FilterViewHeaderContent;
		return DefaultHeader;
	});

	// Initialize theme
	$effect(() => {
		if (browser) {
			theme.init();
		}
	});

	// Show toast when server data was newer (conflict detection)
	$effect(() => {
		const count = $syncConflict;
		if (count > 0) {
			toastStore.info($t('sync.indicator.conflict_title'), {
				description: $t('sync.indicator.conflict_message')
			});
		}
	});

	// Load lists on mount only if E2E is available
	$effect(() => {
		if (isLoading && $session.hasE2E) {
			taskListStore
				.loadLists()
				.then(async () => {
					if ($activeLists.length === 0 && $session.user?.id) {
						if (!navigator.onLine) {
							// First run offline — cannot sync, show blocking UI
							needsOnlineSetup = true;
							isLoading = false;
							return;
						}
						// Online but no lists yet — background sync (initialSync) will
						// pull them from server and call ensureDefaultList() in its
						// post-sync chain. Don't create a list here to avoid duplicates.
					}
					needsOnlineSetup = false;
					isLoading = false;
					taskCounts.refresh();
				})
				.catch((error) => {
					logger.error('Failed to load lists:', error);
					isLoading = false;
				});
		} else if (!$session.hasE2E) {
			isLoading = false;
		}
	});

	// Watch for route changes to update selected list
	// Use $page.route.id (base-path agnostic) instead of $page.url.pathname
	$effect(() => {
		const listId = $page.params.listId;
		const routeId = $page.route.id ?? '';

		// On mobile in task-list view, selectedListId is managed by handleListSelect, not URL
		if (isMobile && mobileView === 'tasks') return;

		if (routeId === '/(app)/starred') {
			selectedListId = 'starred';
			return;
		}
		if (routeId === '/(app)/completed') {
			selectedListId = 'completed';
			return;
		}
		if (routeId === '/(app)/trash') {
			selectedListId = 'trash';
			return;
		}

		if (listId && listId !== selectedListId) {
			selectedListId = listId;
			const list = $activeLists.find((l) => l.id === listId);
			if (list) activeListStore.set(list);
		}

		if (
			!selectedListId &&
			$activeLists.length > 0 &&
			!routeId.startsWith('/(app)/starred')
		) {
			const firstList = $activeLists[0];
			selectedListId = firstList.id;
			activeListStore.set(firstList);
		}
	});

	// Desktop auto-redirect: when on root with lists loaded, go to first list
	$effect(() => {
		if (!browser || isMobile || isLoading) return;
		const routeId = $page.route.id;
		if (routeId === '/(app)' && $activeLists.length > 0) {
			const firstList = $activeLists[0];
			goto(`/lists/${firstList.id}`, { replaceState: true });
		}
	});

	// Sync route → activeSection (for deep links / bookmarks)
	// Only react to route changes — untrack activeSection to avoid circular loop
	// Use $page.route.id (base-path agnostic) instead of $page.url.pathname
	$effect(() => {
		const routeId = $page.route.id ?? '';
		const routeToSection: Record<string, Section> = {
			'/(app)/all': 'all',
			'/(app)/starred': 'starred',
			'/(app)/overdue': 'overdue',
			'/(app)/today': 'today',
			'/(app)/upcoming': 'upcoming',
			'/(app)/no-date': 'no_date',
			'/(app)/trash': 'trash'
		};
		const matchedSection = routeToSection[routeId];
		const currentSection = untrack(() => activeSection);
		if (matchedSection && currentSection !== matchedSection) {
			activeSection = matchedSection;
		} else if (
			(routeId === '/(app)/lists' || routeId?.startsWith('/(app)/lists/')) &&
			currentSection !== 'lists'
		) {
			activeSection = 'lists';
		}
	});

	// Load current task for header actions
	$effect(() => {
		const taskId = currentTaskId;
		const isInitialized = cryptoManager.isInitialized();
		const routeId = $page.route.id;

		if (!taskId || !isInitialized) {
			currentTask = null;
			return;
		}

		let unsubscribe: (() => void) | undefined;
		let cancelled = false;

		const loadTask = async () => {
			if (routeId === '/(app)/tasks/[taskId]') {
				const { taskDetailService } = await import('$lib/services/task-detail.service');
				if (cancelled) return;
				const decryptedTaskStore = taskDetailService.decryptedTask;
				unsubscribe = decryptedTaskStore.subscribe((decryptedTask) => {
					if (decryptedTask) {
						currentTask = decryptedTask;
					} else {
						currentTask = null;
					}
				});
			} else {
				try {
					const encryptedTask = await taskStore.get(taskId);
					if (cancelled) return;
					if (encryptedTask) {
						const title = await cryptoManager.decryptText(encryptedTask.title_encrypted);
						if (cancelled) return;
						currentTask = {
							id: taskId,
							title,
							task_list_id: encryptedTask.task_list_id,
							is_completed: encryptedTask.is_completed,
							is_starred: encryptedTask.is_starred,
							parent_task_id: encryptedTask.parent_task_id
						} as TaskDecrypted;
					} else {
						currentTask = null;
					}
				} catch (error: unknown) {
					logger.error('Failed to load task for header:', error);
					currentTask = null;
				}
			}
		};

		loadTask();

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	});

	// ── Mobile: selected list for Panel 1 task view ─────────────
	let mobileSelectedList = $derived(
		selectedListId &&
			selectedListId !== 'starred' &&
			selectedListId !== 'completed' &&
			selectedListId !== 'trash'
			? $activeLists.find((l) => l.id === selectedListId) || null
			: null
	);

	function handleBackToLists() {
		mobileView = 'sidebar';
		mobileTaskFilters = { option: 'all' };
	}

	function handleSectionClick(section: Section) {
		if (isMobile && section === 'lists' && mobileView === 'tasks') {
			handleBackToLists();
		}
		if (section === 'all') {
			searchFocusRequested = false;
			tick().then(() => {
				searchFocusRequested = true;
			});
		}
		// Clear sidebar search state when switching sections (mirrors NoteList's
		// section-change effect — the sidebar list lives in the new
		// `task-list-view` store and `setSection` triggers an internal refresh,
		// but the search inputs are owned by SidebarTaskList so they reset there
		// too via its own $effect on `section`).
		taskListView.clear();
	}

	// Mobile back: navigate based on current activeSection.
	// Section changes use replaceState, so history.back() might skip sections.
	function handleMobileBack() {
		const routeId = $page.route.id ?? '';

		// For task detail, navigate based on current section
		if (routeId.includes('/tasks/')) {
			const sectionRouteMap: Partial<Record<Section, string>> = {
				all: '/all',
				starred: '/starred',
				overdue: '/overdue',
				today: '/today',
				upcoming: '/upcoming',
				no_date: '/no-date',
				trash: '/trash'
			};
			const target = sectionRouteMap[activeSection];
			if (target) {
				goto(target, { replaceState: true });
			} else if (
				activeSection === 'lists' &&
				selectedListId &&
				!['starred', 'completed', 'trash'].includes(selectedListId)
			) {
				goto(`/lists/${selectedListId}`, { replaceState: true });
			} else {
				history.back();
			}
		} else {
			// For search, settings — history.back() works fine
			history.back();
		}
	}

	async function handleNavigateToList(listId: string) {
		if (isMobile) {
			// Navigate to the specific task list, switching NavIcon to "Lists" section
			selectedListId = listId;
			const list = $activeLists.find((l) => l.id === listId);
			if (list) activeListStore.set(list);

			// Switch to lists section in NavIcon
			activeSection = 'lists';
			await tick();

			// After tick, the section→route effect resets mobileView to 'sidebar'.
			// Override to show the task list directly.
			mobileView = 'tasks';
			mobileTaskFilters = { option: 'all' };
			goto(`/lists/${listId}`, { replaceState: true });
		} else {
			await goto(`/lists/${listId}`);
		}
	}

	// ── List actions ──────────────────────────────────────────────
	async function handleListSelect(listId: string) {
		if (isMobile) {
			// Mobile: special sections go to dedicated pages (Panel 2)
			if (listId === 'starred' || listId === 'completed' || listId === 'trash') {
				selectedListId = listId;
				// These are handled by SidebarTaskList already in Panel 1
				// via activeSection, so no navigation needed
				return;
			}
			// Regular list: show tasks in Panel 1
			selectedListId = listId;
			const list = $activeLists.find((l) => l.id === listId);
			if (list) activeListStore.set(list);
			mobileView = 'tasks';
			mobileTaskFilters = { option: 'all' };
			goto(`/lists/${listId}`, { replaceState: true });
		} else {
			// Desktop: navigate to list page
			if (listId === 'starred') {
				await goto('/starred');
			} else if (listId === 'completed') {
				await goto('/completed');
			} else if (listId === 'trash') {
				await goto('/trash');
			} else {
				await goto(`/lists/${listId}`);
			}
		}
	}

	async function handleTaskSelect(taskId: string) {
		await goto(`/tasks/${taskId}`);
	}

	async function handleCreateSubmit(name: string) {
		isCreating = true;
		try {
			const userId = $session.user?.id;
			if (!userId) throw new Error('Brak identyfikatora użytkownika');
			const newListId = await listOperationsService.createList(userId, name);
			layoutStore.closeCreateList();

			if (newListId) {
				if (isMobile) {
					await tick();
					selectedListId = newListId;
					const list = $activeLists.find((l) => l.id === newListId);
					if (list) activeListStore.set(list);
					mobileView = 'tasks';
					mobileTaskFilters = { option: 'all' };
				} else {
					const targetUrl = `/lists/${newListId}`;
					try {
						await tick();
						await new Promise((resolve) => setTimeout(resolve, 50));
						await goto(targetUrl);
					} catch (navError) {
						logger.error('Navigation failed:', navError);
						untrack(() => (selectedListId = newListId));
						const errorMessage = navError instanceof Error ? navError.message : $t('error.unknown');
						toastStore.error($t('error.navigation_failed'), {
							description: errorMessage,
							duration: 5000
						});
					}
				}
			}
		} catch (error: unknown) {
			logger.error('Failed to create list:', error);
			const errorMessage = error instanceof Error ? error.message : $t('error.unknown');
			toastStore.error($t('taskList.create_error'), {
				description: errorMessage,
				duration: 5000
			});
		} finally {
			isCreating = false;
		}
	}

	async function handleListEditSave(name: string) {
		if (!$layoutStore.selectedListForDialog) return;

		try {
			await listOperationsService.updateList($layoutStore.selectedListForDialog.id, { name });
			toastStore.success($t('taskList.success.updated'));
			layoutStore.closeEditDialog();
		} catch (error: unknown) {
			logger.error('Failed to update list:', error);
			const errorMessage = error instanceof Error ? error.message : $t('error.unknown');
			toastStore.error($t('taskList.update_error'), {
				description: errorMessage,
				duration: 5000
			});
		}
	}

	async function handleListDeleteConfirm(mode: 'with-tasks' | 'move-tasks', targetListId?: string) {
		if (!$layoutStore.selectedListForDialog) return;

		try {
			await listOperationsService.deleteList(
				$layoutStore.selectedListForDialog.id,
				mode === 'with-tasks' ? 'with-tasks' : 'move-tasks',
				targetListId
			);

			await addOperation({
				type: 'delete',
				entityType: 'task_list',
				entityId: $layoutStore.selectedListForDialog.id,
				data: {
					id: $layoutStore.selectedListForDialog.id,
					user_id: '',
					name_encrypted: await cryptoManager.encryptText($layoutStore.selectedListForDialog.name),
					deleteMode: mode,
					targetListId: targetListId
				}
			});

			await taskListStore.loadLists();

			if (selectedListId === $layoutStore.selectedListForDialog.id) {
				untrack(() => {
					activeListStore.set(null);
					selectedListId = null;
				});

				if (isMobile) {
					mobileView = 'sidebar';
				} else {
					await tick();
					await new Promise((resolve) => setTimeout(resolve, 100));

					const firstList = $activeLists[0];
					if (firstList) {
						await goto(`/lists/${firstList.id}`);
					} else {
						await goto('/');
					}
				}
			}

			toastStore.success($t('taskList.success.deleted'));
			layoutStore.closeDeleteDialog();
		} catch (error: unknown) {
			logger.error('Failed to delete list:', error);
			const errorMessage = error instanceof Error ? error.message : $t('error.unknown');
			toastStore.error($t('taskList.errors.delete_failed'), {
				description: errorMessage,
				duration: 5000
			});
		}
	}

	// Task actions for header
	async function toggleTaskCompleted() {
		if (!currentTask || !currentTaskId) return;

		if ($page.route.id === '/(app)/tasks/[taskId]') {
			const { taskDetailService } = await import('$lib/services/task-detail.service');
			await taskDetailService.toggleCompleted();
		} else {
			try {
				await taskOperationsService.toggleCompleted(currentTaskId);
				const encryptedTask = await taskStore.get(currentTaskId);
				if (encryptedTask) {
					currentTask.is_completed = encryptedTask.is_completed;
				}
				toastStore.success(
					currentTask.is_completed ? $t('task.success.completed') : $t('task.success.uncompleted')
				);
			} catch (error: unknown) {
				logger.error('Failed to toggle task completion:', error);
				toastStore.error($t('task.errors.update_failed'));
			}
		}
	}

	async function toggleTaskStarred() {
		if (!currentTask || !currentTaskId) return;

		if ($page.route.id === '/(app)/tasks/[taskId]') {
			const { taskDetailService } = await import('$lib/services/task-detail.service');
			await taskDetailService.toggleStar();
		} else {
			try {
				await taskOperationsService.toggleStarred(currentTaskId);
				const encryptedTask = await taskStore.get(currentTaskId);
				if (encryptedTask) {
					currentTask.is_starred = encryptedTask.is_starred;
				}
				toastStore.success(
					currentTask.is_starred ? $t('task.success.starred') : $t('task.success.unstarred')
				);
			} catch (error: unknown) {
				logger.error('Failed to toggle task star:', error);
				toastStore.error($t('task.errors.update_failed'));
			}
		}
	}

	async function handleTaskDelete(option?: 'this_only' | 'future') {
		if (!currentTask || !currentTaskId) return;

		layoutStore.closeTaskDeleteDialog();
		try {
			if (currentTask.parent_task_id && option) {
				await taskOperationsService.deleteRecurringInstance(currentTaskId, option);
			} else {
				await taskOperationsService.deleteTask(currentTaskId);
			}

			toastStore.success($t('task.success.deleted'), {
				action: {
					label: $t('common.undo'),
					onClick: () => {
						void taskOperationsService
							.updateTask(currentTaskId, {
								deleted_at: undefined
							})
							.then(() => {
								toastStore.success($t('task.success.restored'));
							});
					}
				}
			});

			if (currentList) {
				await goto(`/lists/${currentList.id}`);
			} else {
				await goto('/');
			}
		} catch (error: unknown) {
			logger.error('Failed to delete task:', error);
			toastStore.error($t('task.errors.delete_failed'));
		}
	}

	async function handleMoveToList(targetListId: string) {
		if (!currentTaskId) return;

		try {
			await taskOperationsService.moveTasksToList([currentTaskId], targetListId);
			toastStore.success($t('task.success.moved'));
			layoutStore.closeMoveTaskDialog();
			selectedListId = targetListId;
			const { taskDetailService } = await import('$lib/services/task-detail.service');
			await taskDetailService.loadTask(currentTaskId);
		} catch (error: unknown) {
			logger.error('Failed to move task:', error);
			toastStore.error($t('task.errors.move_failed'));
		}
	}

	// Global keyboard shortcuts
	function handleGlobalKeyDown(e: KeyboardEvent) {
		if (!browser) return;
		const target = e.target as HTMLElement;
		// Don't trigger when typing in inputs or inside dialogs
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable ||
			target.closest('[role="dialog"]') ||
			e.ctrlKey ||
			e.metaKey ||
			e.altKey
		)
			return;

		if (e.key === '/') {
			e.preventDefault();
			window.dispatchEvent(new CustomEvent('focus-search'));
		}
	}

	// Layout children
	let { children } = $props<{ children?: Snippet }>();

	// Only render content if user has E2E access
	let showContent = $derived(browser && $session.isAuthenticated && $session.hasE2E);

	// Auth guard — redirect when session check is done and user is not authenticated
	let isAuthRedirecting = $state(false);

	$effect(() => {
		if (!browser || !$session.isInitialized || $session.isLoading) return;
		if (isAuthRedirecting) return;

		if (!$session.isAuthenticated) {
			const path = $page.url.pathname;
			const returnTo =
				path !== '/' && !path.startsWith(`${base}/auth`) && !path.startsWith('/auth')
					? `?returnTo=${encodeURIComponent(path)}`
					: '';
			isAuthRedirecting = true;
			goto(`/auth/login${returnTo}`, { replaceState: true }).finally(() => {
				isAuthRedirecting = false;
			});
		} else if (!$session.hasE2E) {
			isAuthRedirecting = true;
			goto('/auth/unlock', { replaceState: true }).finally(() => {
				isAuthRedirecting = false;
			});
		}
	});

	// Listen for delete requests from child pages
	$effect(() => {
		if (!browser) return;

		const handleDeleteRequest = (event: CustomEvent) => {
			const { listId, mode, targetListId } = event.detail;
			const list = $activeLists.find((l) => l.id === listId);
			if (list) {
				layoutStore.openDeleteDialog(list);
				handleListDeleteConfirm(mode, targetListId);
			}
		};

		window.addEventListener('list-delete-request', handleDeleteRequest as EventListener);

		return () => {
			window.removeEventListener('list-delete-request', handleDeleteRequest as EventListener);
		};
	});

	// Listen for online event to auto-retry first-run setup
	$effect(() => {
		if (!browser || !needsOnlineSetup) return;

		const handleOnline = () => retryOnlineSetup();
		window.addEventListener('online', handleOnline);
		return () => window.removeEventListener('online', handleOnline);
	});

	async function retryOnlineSetup() {
		if (!$session.user?.id || isRetryingSetup) return;
		isRetryingSetup = true;

		try {
			if (!navigator.onLine) {
				toastStore.error($t('network.offline_mode'));
				return;
			}
			// Trigger sync to pull lists from server
			const { syncService } = await import('$lib/services/sync.service');
			await syncService.initialSync();
			await taskListStore.loadLists();

			// If still no lists, create default
			if ($activeLists.length === 0) {
				await listOperationsService.ensureDefaultList($session.user.id);
				await taskListStore.loadLists();
			}

			if ($activeLists.length > 0) {
				needsOnlineSetup = false;
				taskCounts.refresh();
			}
		} catch (err) {
			logger.error('Retry online setup failed:', err);
		} finally {
			isRetryingSetup = false;
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

{#if showContent}
	{#if needsOnlineSetup}
		<div class="fixed inset-0 z-300 flex items-center justify-center bg-background">
			<div class="flex flex-col items-center gap-4 text-center px-6 max-w-sm">
				<WifiOff class="h-12 w-12 text-muted-foreground" />
				<h2 class="text-lg font-semibold">{$t('network.first_run_online_required')}</h2>
				<p class="text-sm text-muted-foreground">{$t('network.first_run_online_required_desc')}</p>
				<button
					onclick={retryOnlineSetup}
					disabled={isRetryingSetup}
					class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					<RefreshCw class="h-4 w-4 {isRetryingSetup ? 'animate-spin' : ''}" />
					{$t('network.first_run_retry')}
				</button>
			</div>
		</div>
	{/if}

	<a
		href="#main-content"
		class="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:bg-background focus:text-foreground focus:px-4 focus:py-2 focus:rounded-md focus:shadow-md focus:ring-2 focus:ring-ring"
	>
		{$t('common.skip_to_content', { default: 'Przejdź do treści' })}
	</a>

	{#if isMobile}
		<!-- ══════════════════════════════════════════════════════════════════
   MOBILE: Master-Detail with two full-screen panels
   ══════════════════════════════════════════════════════════════════ -->
		<Tooltip.Provider delayDuration={0}>
			<div class="relative h-[100dvh] overflow-hidden bg-sidebar">
				<!-- ── Panel 1: Icon Rail + Sidebar ──────────────────────────── -->
				<div
					class="absolute inset-0 flex transition-transform duration-300 ease-in-out"
					class:-translate-x-full={showDetail}
				>
					<IconNav
						bind:activeSection
						onNewTask={handleNewTask}
						onSectionClick={handleSectionClick}
						alwaysVisible
					/>

					<div class="flex flex-1 flex-col min-w-0 overflow-hidden">
						{#if mobileView === 'tasks' && activeSection === 'lists' && mobileSelectedList}
							<!-- ── Mobile Panel 1: Task list view ──────────────── -->
							<div
								class="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-3"
							>
								<button
									class="flex items-center justify-center h-11 w-11 rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
									onclick={handleBackToLists}
									aria-label={$t('common.back', { default: 'Wstecz' })}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg
									>
								</button>
								<h1
									class="text-sm font-semibold tracking-tight text-sidebar-foreground truncate flex-1 min-w-0"
								>
									{mobileSelectedList.name}
								</h1>
								<div class="flex items-center gap-1 flex-shrink-0">
									<TaskFilterBar bind:filters={mobileTaskFilters} />
									<button
										class="flex items-center justify-center h-11 w-11 rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
										onclick={() => (mobileMenuOpen = true)}
										aria-label={$t('taskList.menu_aria_label', { default: 'Opcje listy' })}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="18"
											height="18"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle
												cx="12"
												cy="19"
												r="1"
											/></svg
										>
									</button>
								</div>
							</div>

							<div class="flex-1 overflow-y-auto p-4">
								{#key mobileSelectedList.id}
									<TaskList bind:this={mobileTaskListRef} listId={mobileSelectedList.id} filters={mobileTaskFilters} />
								{/key}
							</div>

							<SyncStatusFooter />

							<!-- Mobile list menu sheet -->
							<TaskListSheet
								bind:open={mobileMenuOpen}
								list={mobileSelectedList}
								onEdit={() => {
									mobileMenuOpen = false;
									layoutStore.openEditDialog(mobileSelectedList!);
								}}
								onSetDefault={() => {
									mobileMenuOpen = false;
									if (mobileSelectedList)
										listOperationsService.setDefaultList(mobileSelectedList.id);
								}}
								onDelete={() => {
									mobileMenuOpen = false;
									layoutStore.openDeleteDialog(mobileSelectedList!);
								}}
							/>
						{:else}
							<!-- ── Mobile Panel 1: Sidebar view (lists or sections) ── -->
							<!-- Header: logo -->
							<div
								class="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-5"
							>
								<img
									src="{base}/logo-black.svg"
									alt="re/task"
									class="h-5 w-auto block dark:hidden"
								/>
								<img
									src="{base}/logo-white.svg"
									alt="re/task"
									class="h-5 w-auto hidden dark:block dark:opacity-80"
								/>
							</div>

							<!-- Content area -->
							<div class="flex-1 overflow-hidden">
								{#if activeSection === 'lists'}
									<TaskListsPanel
										lists={$activeLists}
										activeListId={selectedListId}
										onListSelect={handleListSelect}
										onListCreate={() => layoutStore.openCreateList()}
										onListEdit={(list) => layoutStore.openEditDialog(list)}
										onListDelete={(list) => layoutStore.openDeleteDialog(list)}
										onSetDefault={(list) => listOperationsService.setDefaultList(list.id)}
									/>
								{:else}
									<SidebarTaskList
										bind:this={sidebarTaskListRef}
										section={activeSection}
										activeTaskId={currentTaskId}
										autoFocusSearch={activeSection === 'all' && searchFocusRequested}
										onTaskSelect={handleTaskSelect}
									/>
								{/if}
							</div>

							<SyncStatusFooter />
						{/if}
					</div>
				</div>

				<!-- ── Panel 2: Detail (task detail / search / settings) ──── -->
				<div
					class="absolute inset-0 flex flex-col bg-background transition-transform duration-300 ease-in-out"
					class:translate-x-full={!showDetail}
					ontouchstart={handleSwipeStart}
					ontouchend={handleSwipeEnd}
					role="region"
					aria-label="Task detail"
				>
					<AppHeader showBackButton={showDetail} onBack={handleMobileBack}>
						{#if headerComponent === TaskDetailHeaderContent}
							<TaskDetailHeaderContent
								list={currentList}
								task={currentTask}
								onToggleCompleted={toggleTaskCompleted}
								onToggleStarred={toggleTaskStarred}
								onOpenMoveDialog={() => {
									if (currentTask) layoutStore.openMoveTaskDialog(currentTask);
								}}
								onOpenDeleteDialog={() => {
									if (currentTask) layoutStore.openTaskDeleteDialog(currentTask);
								}}
								onNavigateToList={currentList
									? () => handleNavigateToList(currentList!.id)
									: undefined}
							/>
						{:else}
							<DefaultHeader />
						{/if}
					</AppHeader>

					<main id="main-content" class="flex-1 overflow-y-auto">
						<div class="@container/main flex flex-1 flex-col h-full">
							{#if children}
								{@render children()}
							{/if}
						</div>
					</main>
				</div>
			</div>
		</Tooltip.Provider>
	{:else}
		<!-- ══════════════════════════════════════════════════════════════════
   DESKTOP: 3-column layout (Icon Rail + Sidebar + Main)
   ══════════════════════════════════════════════════════════════════ -->
		<SidebarProvider
			style="height: 100vh; min-height: 0; overflow: hidden; --sidebar-width: 24rem;"
		>
			<Sidebar
				variant="inset"
				collapsible="offcanvas"
				class="overflow-hidden [&>[data-sidebar=sidebar]]:flex-row"
			>
				<!-- ── Column 1: Icon Rail ────────────────────────────────── -->
				<IconNav bind:activeSection onNewTask={handleNewTask} onSectionClick={handleSectionClick} />

				<!-- ── Column 2: Sidebar content ─────────────────────────── -->
				<div class="flex flex-1 flex-col min-w-0 overflow-hidden">
					<SidebarHeader class="border-b p-0 gap-0">
						<div class="flex h-12 items-center gap-2 px-5">
							<img src="{base}/logo-black.svg" alt="re/task" class="h-4 w-auto block dark:hidden" />
							<img
								src="{base}/logo-white.svg"
								alt="re/task"
								class="h-4 w-auto hidden dark:block dark:opacity-80"
							/>
						</div>
					</SidebarHeader>

					<SidebarContent class="p-0 gap-0">
						{#if activeSection === 'lists'}
							<TaskListsPanel
								lists={$activeLists}
								activeListId={selectedListId}
								onListSelect={handleListSelect}
								onListCreate={() => layoutStore.openCreateList()}
								onListEdit={(list) => layoutStore.openEditDialog(list)}
								onListDelete={(list) => layoutStore.openDeleteDialog(list)}
								onSetDefault={(list) => listOperationsService.setDefaultList(list.id)}
							/>
						{:else}
							<SidebarTaskList
								bind:this={sidebarTaskListRef}
								section={activeSection}
								activeTaskId={currentTaskId}
								autoFocusSearch={activeSection === 'all' && searchFocusRequested}
								hideQuickAdd
								onTaskSelect={handleTaskSelect}
							/>
						{/if}
					</SidebarContent>

					<SyncStatusFooter />
				</div>
			</Sidebar>

			<!-- ── Column 3: Main content area ─────────────────────────────── -->
			<SidebarInset class="overflow-hidden flex flex-col min-w-0 bg-background">
				{#if !showDesktopPlaceholder}
					<AppHeader>
						{#if headerComponent === TaskDetailHeaderContent}
							<TaskDetailHeaderContent
								list={currentList}
								task={currentTask}
								onToggleCompleted={toggleTaskCompleted}
								onToggleStarred={toggleTaskStarred}
								onOpenMoveDialog={() => {
									if (currentTask) layoutStore.openMoveTaskDialog(currentTask);
								}}
								onOpenDeleteDialog={() => {
									if (currentTask) layoutStore.openTaskDeleteDialog(currentTask);
								}}
								onNavigateToList={currentList
									? () => handleNavigateToList(currentList!.id)
									: undefined}
							/>
						{:else if headerComponent === TaskListHeaderContent}
							<TaskListHeaderContent
								list={currentList}
								filters={$layoutStore.taskFilters}
								onFiltersChange={(f) => layoutStore.setTaskFilters(f)}
								onAddTask={handleNewTask}
							/>
						{:else if headerComponent === StarredHeaderContent}
							<StarredHeaderContent />
						{:else if headerComponent === CompletedHeaderContent}
							<CompletedHeaderContent />
						{:else if headerComponent === TrashHeader}
							<TrashHeader />
						{:else if headerComponent === FilterViewHeaderContent}
							<FilterViewHeaderContent section={activeSection} />
						{:else}
							<DefaultHeader />
						{/if}
					</AppHeader>
				{:else}
					<header class="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-6">
						<span class="flex-1"></span>
						<span
							class="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/50
								px-2 py-0.5 text-xs text-muted-foreground select-none"
							title={$t('e2e.badge_tooltip')}
						>
							<Lock class="h-3 w-3" />
							<span class="hidden lg:inline">{$t('e2e.badge')}</span>
							<span class="lg:hidden">{$t('e2e.badge_short')}</span>
						</span>
					</header>
				{/if}

				<main id="main-content" class="flex-1 overflow-y-auto">
					<div class="@container/main flex flex-1 flex-col h-full">
						{#if showDesktopPlaceholder}
							<FilterViewPlaceholder bind:this={filterViewPlaceholderRef} section={activeSection} />
						{:else if children}
							{@render children()}
						{/if}
					</div>
				</main>
			</SidebarInset>
		</SidebarProvider>
	{/if}

	<!-- Create List Sheet -->
	<CreateListSheet
		open={$layoutStore.createListOpen}
		onSubmit={handleCreateSubmit}
		onClose={() => layoutStore.closeCreateList()}
	/>

	<!-- Edit List Dialog -->
	<EditListNameModal
		open={$layoutStore.editDialogOpen}
		list={$layoutStore.selectedListForDialog}
		onSave={handleListEditSave}
		onClose={() => layoutStore.closeEditDialog()}
	/>

	<!-- Delete List Dialog -->
	<DeleteListDialog
		open={$layoutStore.deleteDialogOpen}
		list={$layoutStore.selectedListForDialog}
		allLists={$activeLists}
		onConfirm={handleListDeleteConfirm}
		onClose={() => layoutStore.closeDeleteDialog()}
	/>

	<!-- Task dialogs (for task page) -->
	{#if currentTask}
		<DeleteTaskDialog
			open={$layoutStore.taskDeleteDialogOpen}
			taskTitle={currentTask.title}
			isRecurringInstance={!!currentTask.parent_task_id}
			onConfirm={handleTaskDelete}
			onClose={() => layoutStore.closeTaskDeleteDialog()}
		/>

		<Dialog
			open={$layoutStore.moveTaskDialogOpen}
			onOpenChange={(isOpen) => {
				if (!isOpen) {
					layoutStore.closeMoveTaskDialog();
					moveTargetListId = '';
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{$t('task.move_to_list')}</DialogTitle>
					<DialogDescription>
						{$t('task.move_task_description')}
					</DialogDescription>
				</DialogHeader>
				<div class="py-4">
					<Select
						type="single"
						value={moveTargetListId}
						onValueChange={(value) => (moveTargetListId = value)}
					>
						<SelectTrigger class="w-full">
							{$activeLists.find((l) => l.id === moveTargetListId)?.name ??
								$t('task.placeholders.list')}
						</SelectTrigger>
						<SelectContent>
							{#each $activeLists as list (list.id)}
								{#if list.id !== currentTask?.task_list_id}
									<SelectItem value={list.id}>{list.name}</SelectItem>
								{/if}
							{/each}
						</SelectContent>
					</Select>
				</div>
				<DialogFooter>
					<Button variant="outline" onclick={() => layoutStore.closeMoveTaskDialog()}>
						{$t('common.cancel')}
					</Button>
					<Button disabled={!moveTargetListId} onclick={() => handleMoveToList(moveTargetListId)}>
						{$t('common.move')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	{/if}
{:else}
	<div class="flex items-center justify-center h-screen bg-background">
		<div class="flex flex-col items-center gap-3">
			<div
				class="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin"
			></div>
			<p class="text-sm text-muted-foreground">Ładowanie...</p>
		</div>
	</div>
{/if}
