import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';

const logger = createLogger('UIStore');

// UI state interfaces
interface SidebarState {
	isOpen: boolean;
	isMobileOpen: boolean;
}

interface ModalState {
	createTask: boolean;
	editTask: boolean;
	createList: boolean;
	editList: boolean;
	settings: boolean;
}

interface UIState {
	sidebar: SidebarState;
	modals: ModalState;
	isLoading: boolean;
	loadingMessage?: string;
}

// Default UI state
const defaultState: UIState = {
	sidebar: {
		isOpen: true,
		isMobileOpen: false
	},
	modals: {
		createTask: false,
		editTask: false,
		createList: false,
		editList: false,
		settings: false
	},
	isLoading: false,
	loadingMessage: undefined
};

// Local storage key
const UI_STATE_KEY = 'reborn-task-ui-state';

// Load initial state from localStorage
function loadInitialState(): UIState {
	if (!browser) return defaultState;
	
	try {
		const stored = localStorage.getItem(UI_STATE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			logger.debug('Restored UI state from localStorage');
			return { ...defaultState, ...parsed };
		}
	} catch (error: unknown) {
		logger.error('Failed to restore UI state:', error);
	}
	
	return defaultState;
}

// Create the UI store
function createUIStore() {
	const { subscribe, update } = writable<UIState>(loadInitialState());
	
	// Persist state changes to localStorage
	const persistState = (state: UIState) => {
		if (!browser) return;
		
		try {
			// Only persist sidebar state
			const toPersist = {
				sidebar: state.sidebar
			};
			localStorage.setItem(UI_STATE_KEY, JSON.stringify(toPersist));
		} catch (error: unknown) {
			logger.error('Failed to persist UI state:', error);
		}
	};
	
	return {
		subscribe,
		
		// Sidebar controls
		toggleSidebar() {
			update(state => {
				state.sidebar.isOpen = !state.sidebar.isOpen;
				persistState(state);
				return state;
			});
		},
		
		toggleMobileSidebar() {
			update(state => {
				state.sidebar.isMobileOpen = !state.sidebar.isMobileOpen;
				return state;
			});
		},
		
		closeMobileSidebar() {
			update(state => {
				state.sidebar.isMobileOpen = false;
				return state;
			});
		},
		
		// Modal controls
		openModal(modal: keyof ModalState) {
			update(state => {
				// Close all other modals
				Object.keys(state.modals).forEach(key => {
					state.modals[key as keyof ModalState] = false;
				});
				state.modals[modal] = true;
				return state;
			});
		},
		
		closeModal(modal: keyof ModalState) {
			update(state => {
				state.modals[modal] = false;
				return state;
			});
		},
		
		closeAllModals() {
			update(state => {
				Object.keys(state.modals).forEach(key => {
					state.modals[key as keyof ModalState] = false;
				});
				return state;
			});
		},
		
		// Loading state
		setLoading(isLoading: boolean, message?: string) {
			update(state => {
				state.isLoading = isLoading;
				state.loadingMessage = message;
				return state;
			});
		},
		
		// Reset UI state
		reset() {
			update(() => defaultState);
			if (browser) {
				localStorage.removeItem(UI_STATE_KEY);
			}
		}
	};
}

// Export the UI store
export const uiStore = createUIStore();

// Derived stores for easier access
export const sidebarOpen = writable(true);
export const mobileSidebarOpen = writable(false);

// Subscribe to changes and update derived stores
uiStore.subscribe(state => {
	sidebarOpen.set(state.sidebar.isOpen);
	mobileSidebarOpen.set(state.sidebar.isMobileOpen);
});
