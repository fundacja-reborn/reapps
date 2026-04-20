<script lang="ts">
	import { cn } from '@reborn/ui';
	import { Trash2 } from '@lucide/svelte';
	import { swipe } from '$lib/actions/swipe';
	import { createLogger } from '@reborn/utils';
	import { untrack } from 'svelte';
	import { swipeStore } from '$lib/stores/ui/swipe.store';

	const logger = createLogger('SwipeableItem');

	let {
		onDelete,
		deleteButtonWidth = 80,
		children
	} = $props<{
		onDelete?: () => void | Promise<void>;
		deleteButtonWidth?: number;
		children: import('svelte').Snippet;
	}>();

	let swipeOffset = $state(0);
	let isSwipeOpen = $state(false);
	let isAnimating = $state(false);
	let isDragging = $state(false);
	let preventClick = $state(false);
	let startOffset = 0; // Store the offset when swipe starts
	const itemId = crypto.randomUUID(); // Unique ID for this swipeable item

	const SWIPE_THRESHOLD = 30;
	let MAX_SWIPE_DISTANCE = $derived(deleteButtonWidth);

	// Subscribe to global swipe store
	let openSwipeItemId = $state<string | null>(null);
	const unsubscribe = swipeStore.subscribe((id) => {
		openSwipeItemId = id;
	});

	// Close this item if another one opens
	$effect(() => {
		if (openSwipeItemId && openSwipeItemId !== itemId && isSwipeOpen) {
			untrack(() => {
				isAnimating = true;
				swipeOffset = 0;
				isSwipeOpen = false;
			});
		}
	});

	// Cleanup subscription
	$effect(() => {
		return () => unsubscribe();
	});

	function handleSwipeStart() {
		logger.debug('Swipe started');
		isAnimating = false;
		isDragging = true;
		startOffset = swipeOffset; // Remember where we started
	}

	function handleSwipeMove(distance: number) {
		// Calculate new offset from the starting position
		const newOffset = startOffset + distance;

		// Limit swipe distance between 0 and -MAX_SWIPE_DISTANCE
		const limitedDistance = Math.max(-MAX_SWIPE_DISTANCE, Math.min(0, newOffset));
		swipeOffset = limitedDistance;
	}

	function handleSwipeEnd() {
		logger.debug('Swipe ended', { offset: swipeOffset });
		isAnimating = true;
		isDragging = false;

		// Prevent clicks for a short time after swipe
		preventClick = true;
		setTimeout(() => (preventClick = false), 300);

		// If swiped more than half the delete button width, open it
		if (swipeOffset < -MAX_SWIPE_DISTANCE / 2) {
			swipeOffset = -MAX_SWIPE_DISTANCE;
			isSwipeOpen = true;
			swipeStore.setOpenItemId(itemId);
		} else {
			swipeOffset = 0;
			isSwipeOpen = false;
			if (openSwipeItemId === itemId) {
				swipeStore.setOpenItemId(null);
			}
		}
	}

	function handleSwipeLeft() {
		logger.debug('Swipe left completed');
		isAnimating = true;
		swipeOffset = -MAX_SWIPE_DISTANCE;
		isSwipeOpen = true;
		swipeStore.setOpenItemId(itemId);

		// Prevent clicks for a short time after swipe
		preventClick = true;
		setTimeout(() => (preventClick = false), 300);
	}

	function handleSwipeRight() {
		if (isSwipeOpen) {
			logger.debug('Swipe right - closing');
			isAnimating = true;
			swipeOffset = 0;
			isSwipeOpen = false;
			if (openSwipeItemId === itemId) {
				swipeStore.setOpenItemId(null);
			}
		}
	}

	function handleSwipeCancel() {
		logger.debug('Swipe cancelled');
		isAnimating = true;
		swipeOffset = 0;
		isSwipeOpen = false;
		isDragging = false;
		if (openSwipeItemId === itemId) {
			swipeStore.setOpenItemId(null);
		}
	}

	async function handleDelete(e: MouseEvent) {
		e.stopPropagation();
		logger.debug('Delete button clicked');

		// Reset swipe state immediately
		isAnimating = true;
		swipeOffset = 0;
		isSwipeOpen = false;
		if (openSwipeItemId === itemId) {
			swipeStore.setOpenItemId(null);
		}

		// Call delete handler
		await untrack(() => onDelete?.());
	}

	// Close swipe when clicking outside
	function handleOutsideClick() {
		if (isSwipeOpen) {
			isAnimating = true;
			swipeOffset = 0;
			isSwipeOpen = false;
			if (openSwipeItemId === itemId) {
				swipeStore.setOpenItemId(null);
			}
		}
	}

	// Listen for clicks outside when swipe is open
	$effect(() => {
		if (isSwipeOpen) {
			// Add slight delay to prevent immediate closing
			const timer = setTimeout(() => {
				document.addEventListener('click', handleOutsideClick);
			}, 100);

			return () => {
				clearTimeout(timer);
				document.removeEventListener('click', handleOutsideClick);
			};
		}
	});
</script>

<div class="swipeable-item-container relative overflow-hidden rounded-lg outline-none">
	<!-- Delete button (revealed on swipe) -->
	<div
		class="absolute inset-0 flex items-center justify-end bg-destructive text-destructive-foreground rounded-lg transition-opacity"
		style="opacity: {swipeOffset === 0 && !isDragging ? '0' : '1'}; pointer-events: {swipeOffset ===
			0 && !isDragging
			? 'none'
			: 'auto'};"
	>
		<button
			onclick={handleDelete}
			class="flex h-full items-center justify-center focus:outline-none hover:bg-destructive/90 transition-colors rounded-r-lg"
			style="width: {deleteButtonWidth}px;"
			aria-label="Delete item"
			type="button"
		>
			<Trash2 class="h-5 w-5" />
		</button>
	</div>

	<!-- Main content (swipeable) -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="swipeable-content relative rounded-lg outline-none"
		style="transform: translateX({swipeOffset}px); transition: transform {isAnimating
			? '200ms'
			: '0ms'} ease-out;"
		use:swipe={{
			threshold: SWIPE_THRESHOLD,
			onSwipeStart: handleSwipeStart,
			onSwipeMove: handleSwipeMove,
			onSwipeEnd: handleSwipeEnd,
			onSwipeLeft: handleSwipeLeft,
			onSwipeRight: handleSwipeRight,
			onSwipeCancel: handleSwipeCancel
		}}
		onclick={(e) => {
			// Prevent click propagation when dragging, swipe is open, or just after swipe
			if (isDragging || isSwipeOpen || preventClick) {
				e.preventDefault();
				e.stopPropagation();
			}
		}}
		onkeydown={(e) => {
			if ((e.key === 'Enter' || e.key === ' ') && (isDragging || isSwipeOpen || preventClick)) {
				e.preventDefault();
				e.stopPropagation();
			}
		}}
		role="group"
		aria-label="Swipeable item"
	>
		{@render children()}
	</div>
</div>

<style>
	.swipeable-item-container {
		/* Ensure proper touch handling on iOS */
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
	}

	.swipeable-content {
		/* Improve performance on mobile */
		will-change: transform;
		/* Prevent text selection during swipe */
		-webkit-user-select: none;
		user-select: none;
	}
</style>
