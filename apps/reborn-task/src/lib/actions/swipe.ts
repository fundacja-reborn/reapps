import { createLogger } from '@reborn/utils';

const logger = createLogger('SwipeAction');

export interface SwipeOptions {
	threshold?: number; // Minimum distance to consider it a swipe
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
	onSwipeStart?: () => void;
	onSwipeMove?: (distance: number) => void;
	onSwipeEnd?: () => void;
	onSwipeCancel?: () => void;
}

export function swipe(node: HTMLElement, options: SwipeOptions = {}) {
	const {
		threshold = 30,
		onSwipeLeft,
		onSwipeRight,
		onSwipeStart,
		onSwipeMove,
		onSwipeEnd,
		onSwipeCancel
	} = options;

	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	let isSwiping = false;
	let isVerticalScroll = false;

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;

		const touch = e.touches[0];
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchStartTime = Date.now();
		isSwiping = false;
		isVerticalScroll = false;

		logger.debug('Touch start', { x: touchStartX, y: touchStartY });
	}

	function handleTouchMove(e: TouchEvent) {
		if (e.touches.length !== 1) return;

		const touch = e.touches[0];
		const deltaX = touch.clientX - touchStartX;
		const deltaY = touch.clientY - touchStartY;

		// Determine if this is a vertical scroll
		if (!isSwiping && Math.abs(deltaY) > Math.abs(deltaX)) {
			isVerticalScroll = true;
			return;
		}

		// If it's a vertical scroll, don't process as swipe
		if (isVerticalScroll) return;

		// Check if movement exceeds threshold
		if (Math.abs(deltaX) > threshold && !isSwiping) {
			isSwiping = true;
			onSwipeStart?.();
			logger.debug('Swipe started');
		}

		if (isSwiping) {
			e.preventDefault(); // Prevent scrolling while swiping
			onSwipeMove?.(deltaX);
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!isSwiping || isVerticalScroll) {
			if (isSwiping) {
				onSwipeCancel?.();
			}
			return;
		}

		const touch = e.changedTouches[0];
		const deltaX = touch.clientX - touchStartX;
		const deltaTime = Date.now() - touchStartTime;

		logger.debug('Touch end', { deltaX, deltaTime });

		// Determine swipe direction
		if (Math.abs(deltaX) > threshold) {
			if (deltaX < 0) {
				logger.debug('Swipe left detected');
				onSwipeLeft?.();
			} else {
				logger.debug('Swipe right detected');
				onSwipeRight?.();
			}
		}

		onSwipeEnd?.();
		isSwiping = false;
	}

	function handleTouchCancel() {
		if (isSwiping) {
			onSwipeCancel?.();
			isSwiping = false;
		}
	}

	// Mouse events for desktop testing
	let mouseStartX = 0;
	let isMouseDown = false;

	function handleMouseDown(e: MouseEvent) {
		// Prevent text selection during drag
		e.preventDefault();
		
		mouseStartX = e.clientX;
		touchStartX = e.clientX;
		touchStartY = e.clientY;
		touchStartTime = Date.now();
		isMouseDown = true;
		isSwiping = false;
		isVerticalScroll = false;
	}

	function handleMouseMove(e: MouseEvent) {
		if (!isMouseDown) return;

		const deltaX = e.clientX - mouseStartX;

		if (Math.abs(deltaX) > threshold && !isSwiping) {
			isSwiping = true;
			onSwipeStart?.();
		}

		if (isSwiping) {
			e.preventDefault();
			onSwipeMove?.(deltaX);
		}
	}

	function handleMouseUp(e: MouseEvent) {
		if (!isMouseDown) return;

		isMouseDown = false;

		if (!isSwiping) return;

		// Prevent click event after swipe
		e.preventDefault();
		e.stopPropagation();

		const deltaX = e.clientX - mouseStartX;

		if (Math.abs(deltaX) > threshold) {
			if (deltaX < 0) {
				onSwipeLeft?.();
			} else {
				onSwipeRight?.();
			}
		}

		onSwipeEnd?.();
		isSwiping = false;
	}

	function handleMouseLeave() {
		if (isMouseDown && isSwiping) {
			onSwipeCancel?.();
			isMouseDown = false;
			isSwiping = false;
		}
	}

	// Add event listeners
	node.addEventListener('touchstart', handleTouchStart, { passive: true });
	node.addEventListener('touchmove', handleTouchMove, { passive: false });
	node.addEventListener('touchend', handleTouchEnd, { passive: true });
	node.addEventListener('touchcancel', handleTouchCancel, { passive: true });

	// Mouse events for desktop testing
	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mousemove', handleMouseMove);
	node.addEventListener('mouseup', handleMouseUp);
	node.addEventListener('mouseleave', handleMouseLeave);

	return {
		update(newOptions: SwipeOptions) {
			Object.assign(options, newOptions);
		},
		destroy() {
			// Remove event listeners
			node.removeEventListener('touchstart', handleTouchStart);
			node.removeEventListener('touchmove', handleTouchMove);
			node.removeEventListener('touchend', handleTouchEnd);
			node.removeEventListener('touchcancel', handleTouchCancel);
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mousemove', handleMouseMove);
			node.removeEventListener('mouseup', handleMouseUp);
			node.removeEventListener('mouseleave', handleMouseLeave);
		}
	};
}
