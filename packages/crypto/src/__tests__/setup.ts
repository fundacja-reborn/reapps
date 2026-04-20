/**
 * Test setup file for @reborn/crypto
 * Configures the test environment and provides necessary mocks
 */

import { beforeAll, beforeEach, vi } from 'vitest';

// Setup crypto polyfills for testing
beforeAll(() => {
  // Mock window object with sessionStorage
  const windowMock = {
    sessionStorage: (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
          store[key] = value.toString();
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          store = {};
        }
      };
    })()
  };

  // Make window available globally
  (global as any).window = windowMock;

  // Mock btoa and atob if not available
  if (typeof btoa === 'undefined') {
    global.btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
  }
  
  if (typeof atob === 'undefined') {
    global.atob = (base64: string) => Buffer.from(base64, 'base64').toString('binary');
  }
});

// Reset mocks before each test
beforeEach(() => {
  // Clear sessionStorage before each test
  if ((global as any).window?.sessionStorage) {
    (global as any).window.sessionStorage.clear();
  }
  
  // Clear all mocks
  vi.clearAllMocks();
});
