import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../services/SessionManager';
import type { AuthSession, AuthUser } from '../types';

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  it('should initialize with default state', () => {
    const session = sessionManager.getCurrentSession();
    
    expect(session.isAuthenticated).toBe(false);
    expect(session.isInitialized).toBe(false);
    expect(session.hasE2E).toBe(false);
    expect(session.user).toBe(null);
    expect(session.error).toBe(null);
    expect(session.isLoading).toBe(false);
    expect(session.isLoggingOut).toBe(false);
  });

  it('should update session state', () => {
    const newState: Partial<AuthSession> = {
      isAuthenticated: true,
      hasE2E: true,
      error: 'Test error'
    };

    sessionManager.setSession(newState);
    const session = sessionManager.getCurrentSession();

    expect(session.isAuthenticated).toBe(true);
    expect(session.hasE2E).toBe(true);
    expect(session.error).toBe('Test error');
  });

  it('should set authenticated user', () => {
    const user: AuthUser = {
      id: '123',
      username: 'testuser',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    };

    sessionManager.setAuthenticated(user, true);
    const session = sessionManager.getCurrentSession();

    expect(session.isAuthenticated).toBe(true);
    expect(session.isInitialized).toBe(true);
    expect(session.hasE2E).toBe(true);
    expect(session.user).toEqual(user);
    expect(session.error).toBe(null);
    expect(session.isLoading).toBe(false);
  });

  it('should clear session', () => {
    const user: AuthUser = {
      id: '123',
      username: 'testuser',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    };

    sessionManager.setAuthenticated(user, true);
    sessionManager.clearSession();

    const session = sessionManager.getCurrentSession();
    
    expect(session.isAuthenticated).toBe(false);
    expect(session.hasE2E).toBe(false);
    expect(session.user).toBe(null);
    expect(session.isInitialized).toBe(true); // Remains true after clear
  });

  it('should notify subscribers on state change', () => {
    let notificationCount = 0;
    let lastSession: AuthSession | null = null;

    const unsubscribe = sessionManager.subscribe((session) => {
      notificationCount++;
      lastSession = session;
    });

    // Should be called immediately with current state
    expect(notificationCount).toBe(1);
    expect(lastSession?.isAuthenticated).toBe(false);

    // Update state
    sessionManager.setLoading(true);
    expect(notificationCount).toBe(2);
    expect(lastSession?.isLoading).toBe(true);

    // Set error
    sessionManager.setError('Test error');
    expect(notificationCount).toBe(3);
    expect(lastSession?.error).toBe('Test error');
    expect(lastSession?.isLoading).toBe(false);

    // Cleanup
    unsubscribe();
    
    // Should not receive updates after unsubscribe
    sessionManager.setLoading(true);
    expect(notificationCount).toBe(3);
  });

  it('should handle update function', () => {
    sessionManager.updateSession((current) => ({
      isLoading: !current.isLoading,
      error: current.error ? null : 'New error'
    }));

    const session = sessionManager.getCurrentSession();
    expect(session.isLoading).toBe(true);
    expect(session.error).toBe('New error');

    sessionManager.updateSession((current) => ({
      isLoading: !current.isLoading,
      error: current.error ? null : 'New error'
    }));

    const session2 = sessionManager.getCurrentSession();
    expect(session2.isLoading).toBe(false);
    expect(session2.error).toBe(null);
  });
});
