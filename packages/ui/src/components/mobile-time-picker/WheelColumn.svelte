<script lang="ts">
	import { cn } from '../../utils/cn.js';

	const ITEM_HEIGHT = 44;
	const VISIBLE_ITEMS = 7;
	const PADDING_ITEMS = Math.floor(VISIBLE_ITEMS / 2);

	let {
		items,
		value = $bindable(0),
		class: className = '',
		label = ''
	} = $props<{
		items: number[];
		value?: number;
		class?: string;
		label?: string;
	}>();

	let containerRef = $state<HTMLDivElement>();

	// --- Manual touch scrolling ---
	// vaul-svelte sets touch-action: none on [data-vaul-drawer], which blocks native
	// touch scrolling. CSS scroll-snap also fights with manual scrollTop updates.
	// We handle everything manually: touch tracking, momentum, snapping, and highlighting.
	let touchStartY = 0;
	let touchStartScrollTop = 0;
	let isTouching = $state(false);
	let isMomentum = $state(false);
	let lastTouchY = 0;
	let lastTouchTime = 0;
	let velocity = 0;
	let momentumRaf = 0;

	// Live scroll-based index for visual highlighting during touch/momentum
	let scrollIndex = $state(-1);

	function getScrollIndex(): number {
		if (!containerRef) return items.indexOf(value);
		return Math.round(containerRef.scrollTop / ITEM_HEIGHT);
	}

	function handleTouchStart(e: TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (!containerRef) return;
		cancelAnimationFrame(momentumRaf);
		isTouching = true;
		isMomentum = false;
		touchStartY = e.touches[0].clientY;
		touchStartScrollTop = containerRef.scrollTop;
		lastTouchY = touchStartY;
		lastTouchTime = Date.now();
		velocity = 0;
		scrollIndex = getScrollIndex();
	}

	function handleTouchMove(e: TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (!isTouching || !containerRef) return;
		const currentY = e.touches[0].clientY;
		const now = Date.now();
		const dt = now - lastTouchTime;
		if (dt > 0) {
			velocity = (lastTouchY - currentY) / dt; // px/ms
		}
		lastTouchY = currentY;
		lastTouchTime = now;
		const delta = touchStartY - currentY;
		containerRef.scrollTop = touchStartScrollTop + delta;
		// Update visual highlight in real-time
		scrollIndex = getScrollIndex();
	}

	function handleTouchEnd(e: TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (!isTouching || !containerRef) return;
		isTouching = false;
		const FRICTION = 0.95;
		const MIN_VELOCITY = 0.3;
		let v = velocity * 16; // px per frame (~16ms)
		if (Math.abs(v) > MIN_VELOCITY) {
			isMomentum = true;
			const step = () => {
				if (!containerRef || Math.abs(v) < MIN_VELOCITY) {
					isMomentum = false;
					snapAndCommit();
					return;
				}
				containerRef.scrollTop += v;
				scrollIndex = getScrollIndex();
				v *= FRICTION;
				momentumRaf = requestAnimationFrame(step);
			};
			momentumRaf = requestAnimationFrame(step);
		} else {
			snapAndCommit();
		}
	}

	function snapAndCommit() {
		if (!containerRef) return;
		const index = Math.round(containerRef.scrollTop / ITEM_HEIGHT);
		const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
		const targetTop = clampedIndex * ITEM_HEIGHT;
		animateScrollTo(targetTop, () => {
			scrollIndex = clampedIndex;
			const newValue = items[clampedIndex];
			if (newValue !== value) {
				value = newValue;
			}
		});
	}

	function animateScrollTo(target: number, onDone?: () => void) {
		if (!containerRef) { onDone?.(); return; }
		cancelAnimationFrame(momentumRaf);
		const start = containerRef.scrollTop;
		const distance = target - start;
		if (Math.abs(distance) < 1) {
			containerRef.scrollTop = target;
			onDone?.();
			return;
		}
		const duration = 150;
		const startTime = performance.now();
		const step = (now: number) => {
			if (!containerRef) { onDone?.(); return; }
			const elapsed = now - startTime;
			const t = Math.min(elapsed / duration, 1);
			const eased = t * (2 - t); // ease-out quad
			containerRef.scrollTop = start + distance * eased;
			scrollIndex = getScrollIndex();
			if (t < 1) {
				momentumRaf = requestAnimationFrame(step);
			} else {
				containerRef.scrollTop = target;
				onDone?.();
			}
		};
		momentumRaf = requestAnimationFrame(step);
	}

	// Scroll to position on mount and when value changes externally
	$effect(() => {
		if (!containerRef) return;
		if (isTouching || isMomentum) return;
		const index = items.indexOf(value);
		if (index === -1) return;
		const targetScroll = index * ITEM_HEIGHT;
		if (Math.abs(containerRef.scrollTop - targetScroll) > 2) {
			containerRef.scrollTop = targetScroll;
		}
		scrollIndex = index;
	});

	// Which item index is visually active (centered)
	let activeIndex = $derived(
		(isTouching || isMomentum)
			? Math.max(0, Math.min(scrollIndex, items.length - 1))
			: items.indexOf(value)
	);

	function formatValue(v: number): string {
		return String(v).padStart(2, '0');
	}
</script>

<div class="flex flex-col items-center">
	{#if label}
		<span class="text-xs text-muted-foreground mb-1 font-medium">{label}</span>
	{/if}
	<div class="relative" style="height: {VISIBLE_ITEMS * ITEM_HEIGHT}px;">
		<!-- Selection highlight bar -->
		<div
			class="pointer-events-none absolute inset-x-0 z-10 border-y border-border bg-accent/40 rounded"
			style="top: {PADDING_ITEMS * ITEM_HEIGHT}px; height: {ITEM_HEIGHT}px;"
		></div>

		<!-- Scrollable container -->
		<div
			bind:this={containerRef}
			ontouchstart={handleTouchStart}
			ontouchmove={handleTouchMove}
			ontouchend={handleTouchEnd}
			ontouchcancel={handleTouchEnd}
			data-vaul-no-drag
			class={cn(
				"overflow-y-auto no-scrollbar",
				className
			)}
			style="height: {VISIBLE_ITEMS * ITEM_HEIGHT}px; touch-action: none; overscroll-behavior: contain;"
			role="listbox"
			aria-label={label}
			tabindex="0"
		>
			<!-- Top padding so first real item can land in center -->
			<div style="height: {PADDING_ITEMS * ITEM_HEIGHT}px;" aria-hidden="true"></div>

			{#each items as item, i}
				{@const isActive = i === activeIndex}
				<div
					class={cn(
						"flex items-center justify-center select-none",
						isActive ? "text-foreground font-semibold text-2xl" : "text-muted-foreground text-lg"
					)}
					style="height: {ITEM_HEIGHT}px;"
					role="option"
					aria-selected={isActive}
				>
					{formatValue(item)}
				</div>
			{/each}

			<!-- Bottom padding so last real item can land in center -->
			<div style="height: {PADDING_ITEMS * ITEM_HEIGHT}px;" aria-hidden="true"></div>
		</div>

		<!-- Fade edges -->
		<div class="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-background to-transparent z-20"></div>
		<div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent z-20"></div>
	</div>
</div>

<style>
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
</style>
