/**
 * Re-export main sync service and related types
 * This maintains backward compatibility with existing imports
 */
export {
	syncService,
	syncProgress,
	syncConflict,
	lastSyncedAt,
	type SyncProgress
} from './sync.service';
