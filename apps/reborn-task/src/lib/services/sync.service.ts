/**
 * Re-export from the sync folder to maintain backward compatibility
 * with existing imports like: import { syncService } from '$lib/services/sync.service';
 */
export { syncService, syncProgress, syncConflict, type SyncProgress } from './sync';
