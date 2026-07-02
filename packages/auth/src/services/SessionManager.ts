import { createLogger } from '@reborn/utils';
import type { AuthSession, AuthUser, SessionManager as ISessionManager } from '../types';

const logger = createLogger('SessionManager');

/**
 * Framework-agnostic session manager
 * Stores session state in memory and provides methods to manipulate it
 */
export class SessionManager implements ISessionManager {
  private session: AuthSession;
  private listeners: Set<(session: AuthSession) => void>;

  constructor() {
    this.session = {
      isAuthenticated: false,
      isInitialized: false,
      hasE2E: false,
      user: null,
      error: null,
      isLoading: false,
      isLoggingOut: false
    };
    this.listeners = new Set();
    logger.debug('SessionManager initialized');
  }

  /**
   * Get current session state
   */
  getCurrentSession(): AuthSession {
    return { ...this.session };
  }

  /**
   * Set session state
   */
  setSession(session: Partial<AuthSession>): void {
    this.session = {
      ...this.session,
      ...session
    };
    this.notifyListeners();
    logger.debug('Session updated', { isAuthenticated: this.session.isAuthenticated, hasE2E: this.session.hasE2E });
  }

  /**
   * Update session state
   */
  updateSession(updater: (session: AuthSession) => Partial<AuthSession>): void {
    const updates = updater(this.getCurrentSession());
    this.setSession(updates);
  }

  /**
   * Clear session to initial state
   */
  clearSession(): void {
    this.session = {
      isAuthenticated: false,
      isInitialized: true,
      hasE2E: false,
      user: null,
      error: null,
      isLoading: false,
      isLoggingOut: false
    };
    this.notifyListeners();
    logger.debug('Session cleared');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.session.isAuthenticated;
  }

  /**
   * Check if E2E encryption is enabled
   */
  hasE2E(): boolean {
    return this.session.hasE2E;
  }

  /**
   * Get current user
   */
  getCurrentUser(): AuthUser | null {
    return this.session.user;
  }

  /**
   * Set loading state
   */
  setLoading(isLoading: boolean): void {
    this.setSession({ isLoading });
  }

  /**
   * Set error state
   */
  setError(error: string | null): void {
    this.setSession({ error, isLoading: false });
  }

  /**
   * Subscribe to session changes
   */
  subscribe(listener: (session: AuthSession) => void): () => void {
    this.listeners.add(listener);
    // Call listener immediately with current state
    listener(this.getCurrentSession());
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of session change
   */
  private notifyListeners(): void {
    const currentSession = this.getCurrentSession();
    this.listeners.forEach(listener => {
      try {
        listener(currentSession);
      } catch (error) {
        logger.error('Error in session listener:', error);
      }
    });
  }

  /**
   * Set user authentication
   *
   * Explicitly drops `isLocalOnly`: an authenticated session is by definition
   * not local-only. setSession() merges, so without this a login that replaced
   * a local-only session would keep the stale flag and every raw
   * `session.isLocalOnly` read (nav menus, guards) would still render local
   * mode. Mirrors the single-write-path `commit()` fix in reborn-notes (#314).
   */
  setAuthenticated(user: AuthUser, hasE2E = true): void {
    this.setSession({
      isAuthenticated: true,
      isLocalOnly: false,
      isInitialized: true,
      hasE2E,
      user,
      error: null,
      isLoading: false
    });
    logger.info('User authenticated', { userId: user.id, hasE2E });
  }

  /**
   * Set logout in progress
   */
  setLoggingOut(isLoggingOut: boolean): void {
    this.setSession({ isLoggingOut });
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.clearSession();
    this.listeners.clear();
    logger.debug('SessionManager reset');
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();
