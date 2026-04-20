// Using Svelte 5 runes - no imports needed

/**
 * Media query hook for responsive design
 * @param query - Media query string (e.g., '(max-width: 768px)')
 * @returns Reactive boolean indicating if the query matches
 */
export function useMediaQuery(query: string) {
	let matches = $state(false);
	
	// Initialize only on client side
	if (typeof window !== 'undefined') {
		const mediaQuery = window.matchMedia(query);
		
		// Set initial value
		matches = mediaQuery.matches;
		
		// Create event handler
		const handler = (event: MediaQueryListEvent) => {
			matches = event.matches;
		};
		
		// Add event listener
		mediaQuery.addEventListener('change', handler);
		
		// Cleanup on component destroy
		$effect(() => {
			return () => {
				mediaQuery.removeEventListener('change', handler);
			};
		});
	}
	
	return {
		get value() { return matches; }
	};
}

// Common breakpoints
export const breakpoints = {
	mobile: '(max-width: 768px)',
	tablet: '(min-width: 769px) and (max-width: 1024px)',
	desktop: '(min-width: 1025px)',
	// Touch device detection
	touch: '(hover: none) and (pointer: coarse)',
	// Specific mobile sizes
	smallMobile: '(max-width: 375px)',
	largeMobile: '(min-width: 376px) and (max-width: 428px)'
};

// Pre-configured hooks
export const useIsMobile = () => useMediaQuery(breakpoints.mobile);
export const useIsTablet = () => useMediaQuery(breakpoints.tablet);
export const useIsDesktop = () => useMediaQuery(breakpoints.desktop);
export const useIsTouchDevice = () => useMediaQuery(breakpoints.touch);
