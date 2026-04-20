/**
 * Create reactive session store
 * This provides a framework-agnostic way to create reactive session state
 */

import type { SessionManager } from '../services/SessionManager';
import type { AuthSession } from '../types';

export interface ReactiveStore<T> {
  subscribe(subscriber: (value: T) => void): () => void;
  update(updater: (value: T) => T): void;
  set(value: T): void;
}

export interface SessionStore extends ReactiveStore<AuthSession> {
  // Additional session-specific methods
  isAuthenticated: () => boolean;
  hasE2E: () => boolean;
  getCurrentUser: () => AuthSession['user'];
  reset: () => void;
}

/**
 * Create a reactive session store
 * This can be adapted for different frameworks (Svelte, Vue, React)
 */
export function createSessionStore(
  sessionManager: SessionManager,
  createStore: <T>(initialValue: T) => ReactiveStore<T>
): SessionStore {
  // Create the base reactive store
  const store = createStore<AuthSession>(sessionManager.getCurrentSession());

  // Subscribe to session changes
  let unsubscribe: (() => void) | null = null;

  // Enhanced store with session-specific methods
  const sessionStore: SessionStore = {
    subscribe(subscriber: (value: AuthSession) => void) {
      // Subscribe to store changes
      const storeUnsubscribe = store.subscribe(subscriber);

      // Subscribe to session manager changes if not already subscribed
      if (!unsubscribe) {
        unsubscribe = sessionManager.subscribe((session) => {
          store.set(session);
        });
      }

      // Return cleanup function
      return () => {
        storeUnsubscribe();
        // Note: We don't unsubscribe from sessionManager here
        // as other subscribers might still need it
      };
    },

    update(updater: (value: AuthSession) => AuthSession) {
      store.update(updater);
    },

    set(value: AuthSession) {
      store.set(value);
      sessionManager.setSession(value);
    },

    isAuthenticated(): boolean {
      return sessionManager.isAuthenticated();
    },

    hasE2E(): boolean {
      return sessionManager.hasE2E();
    },

    getCurrentUser() {
      return sessionManager.getCurrentSession().user;
    },

    reset() {
      sessionManager.clearSession();
      store.set(sessionManager.getCurrentSession());
    }
  };

  return sessionStore;
}

/**
 * Create a Svelte-compatible session store
 */
export function createSvelteSessionStore(sessionManager: SessionManager): SessionStore {
  // This would be implemented in the Svelte app using Svelte's writable store
  // Example implementation:
  // import { writable } from 'svelte/store';
  // return createSessionStore(sessionManager, writable);
  
  throw new Error(
    'createSvelteSessionStore should be implemented in the Svelte app ' +
    'using Svelte\'s writable store'
  );
}

/**
 * Create derived stores for specific session properties
 */
export interface DerivedStores {
  isAuthenticated: ReactiveStore<boolean>;
  hasE2E: ReactiveStore<boolean>;
  user: ReactiveStore<AuthSession['user']>;
  isLoading: ReactiveStore<boolean>;
  error: ReactiveStore<string | null>;
}

export function createDerivedStores(
  sessionStore: SessionStore,
  derive: <T, U>(store: ReactiveStore<T>, fn: (value: T) => U) => ReactiveStore<U>
): DerivedStores {
  return {
    isAuthenticated: derive(sessionStore, (session) => session.isAuthenticated),
    hasE2E: derive(sessionStore, (session) => session.hasE2E),
    user: derive(sessionStore, (session) => session.user),
    isLoading: derive(sessionStore, (session) => session.isLoading),
    error: derive(sessionStore, (session) => session.error)
  };
}

/**
 * Helper to check authentication state synchronously
 */
export function checkAuth(sessionStore: SessionStore): {
  isAuthenticated: boolean;
  hasE2E: boolean;
  user: AuthSession['user'];
} {
  let currentSession: AuthSession = {
    isAuthenticated: false,
    isInitialized: false,
    hasE2E: false,
    user: null,
    error: null,
    isLoading: false,
    isLoggingOut: false
  };
  
  // Get current value synchronously
  const unsubscribe = sessionStore.subscribe((session) => {
    currentSession = session;
  });
  unsubscribe();

  return {
    isAuthenticated: currentSession.isAuthenticated,
    hasE2E: currentSession.hasE2E,
    user: currentSession.user
  };
}
