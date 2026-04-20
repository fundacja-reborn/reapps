/**
 * Import/Export types for RebornTask
 */

export type ExportMode = 'encrypted' | 'decrypted';

export interface ExportOptions {
	mode: ExportMode;
	includeLists: boolean;
	includeTasks: boolean;
	includeSubtasks: boolean;
	includeCompleted: boolean;
	includeDeleted: boolean;
}

export interface ExportData {
	version: string;
	exportDate: string;
	exportMode: ExportMode;
	lists?: unknown[];
	tasks?: unknown[];
	subtasks?: unknown[];
}

export interface ImportResult {
	success: boolean;
	imported: {
		lists: number;
		tasks: number;
		subtasks: number;
	};
	errors: string[];
}

export interface ImportOptions {
	overwriteExisting: boolean;
	validateReferences: boolean;
}
