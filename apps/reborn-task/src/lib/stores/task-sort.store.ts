/**
 * Task Sort Store
 * 
 * Manages task sorting preferences for each list.
 * Stores preferences locally in the browser.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export type TaskSortOption =
  | 'due_date' // Earliest first (default)
  | 'alphabetical' // A-Z by title
  | 'created_date' // Newest first
  | 'starred'; // Starred first

export type TaskSortDirection = 'asc' | 'desc';

interface TaskSortPreferences {
  [listId: string]: {
    option: TaskSortOption;
    direction: TaskSortDirection;
  };
}

const STORAGE_KEY = 'reborn-task-sort-preferences';

function createTaskSortStore() {
  // Load saved preferences from localStorage
  const savedPreferences = browser
    ? JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    : {};

  const { subscribe, update } = writable<TaskSortPreferences>(savedPreferences);

  return {
    subscribe,
    
    /**
     * Get sort preferences for a specific list
     */
    getListSort(listId: string): { option: TaskSortOption; direction: TaskSortDirection } {
      const preferences = get({ subscribe });
      return preferences[listId] || { option: 'due_date', direction: 'asc' };
    },
    
    /**
     * Set sort preferences for a specific list
     */
    setListSort(listId: string, option: TaskSortOption, direction: TaskSortDirection = 'asc') {
      update(prefs => {
        const newPrefs = {
          ...prefs,
          [listId]: { option, direction }
        };
        
        // Save to localStorage
        if (browser) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
        }
        
        return newPrefs;
      });
    },
    
    /**
     * Clear sort preferences for a list
     */
    clearListSort(listId: string) {
      update(prefs => {
        const newPrefs = { ...prefs };
        delete newPrefs[listId];
        
        // Save to localStorage
        if (browser) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
        }
        
        return newPrefs;
      });
    }
  };
}

export const taskSortStore = createTaskSortStore();
