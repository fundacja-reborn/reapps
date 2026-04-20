const MOBILE_BREAKPOINT = 768;

export class IsMobile {
	#mediaQuery: MediaQueryList | null = null;
	#matches = $state(false);

	constructor() {
		if (typeof window !== 'undefined') {
			this.#mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
			this.#matches = this.#mediaQuery.matches;
			
			this.#mediaQuery.addEventListener('change', (e) => {
				this.#matches = e.matches;
			});
		}
	}

	get matches() {
		return this.#matches;
	}
}
