// Storage-related types
import type { DecryptedTaskList, EncryptedTaskList, StoredTaskList } from './entities/list';
import type {
  DecryptedTask,
  EncryptedTask,
  DecryptedSubTask,
  EncryptedSubTask
} from './entities/task';

// Common database/storage types
export interface SyncState {
  id: string;
  lastSyncTimestamp: number;
  version: number;
}

export interface IdMapping {
  id: string;
  oldId: string;
  newId: string;
  entityType: 'tasklist' | 'task' | 'subtask' | 'folder' | 'note' | 'tag';
  migratedAt: string;
}

export interface OfflineOperation {
  id: string;
  entityType: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  data: unknown;
  createdAt: string;
  retryCount?: number;
  lastError?: string;
}

// Typy używane w IndexedDB są teraz te same co EncryptedTask i EncryptedSubTask
export type StoredTask = EncryptedTask;
export type StoredSubTask = EncryptedSubTask;

export interface TaskUpdate {
  title_encrypted?: string;
  description_encrypted?: string | null;
  metadata_encrypted?: string;
  recurrence_rule_encrypted?: string | null;
  parent_task_id?: string;
  is_template?: 0 | 1;
  task_list_id?: string;
  // Local-only shadow indexes (never sent to server)
  is_completed?: 0 | 1;
  is_starred?: 0 | 1;
  is_recurring?: 0 | 1;
  due_date?: string | null;
  [key: string]: unknown;
}

// Offline operation types
export type OperationType = 'create' | 'update' | 'delete';
export type EntityType = 'task_list' | 'task' | 'sub_task';
export type OperationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// Extended offline operation with additional fields
export interface ExtendedOfflineOperation extends OfflineOperation {
  type: OperationType; // Typ operacji (create, update, delete)
  entityType: EntityType; // Typ encji, której dotyczy operacja
  timestamp: number; // Czas utworzenia operacji (ms od epoki)
  updated_at?: number; // Czas ostatniej aktualizacji operacji
  status?: OperationStatus; // Status operacji
  error?: string; // Ostatni błąd synchronizacji
  last_error_time?: number; // Czas ostatniego błędu
  priority?: number; // Priorytet operacji (wyższy = ważniejszy)
  dependencies?: string[]; // Identyfikatory operacji, od których ta operacja zależy
}

// Re-export as StorageOfflineOperation for compatibility
export type StorageOfflineOperation = ExtendedOfflineOperation;

export interface SyncMetadata {
  lastSyncTime: number; // Ostatnia udana synchronizacja (ms od epoki)
  syncInProgress: boolean; // Czy synchronizacja jest w toku
  pendingOperationsCount: number; // Liczba operacji oczekujących na synchronizację
  failedOperationsCount: number; // Liczba nieudanych operacji synchronizacji
}

export interface SyncStatus {
  online: boolean; // Czy aplikacja jest online
  lastSyncTime: number | null; // Czas ostatniej udanej synchronizacji
  pendingChanges: number; // Liczba zmian oczekujących na wysłanie
  syncInProgress: boolean; // Czy synchronizacja jest aktualnie w toku
  syncError: string | null; // Ostatni błąd synchronizacji (jeśli wystąpił)
}

export interface SyncOperationResult {
  success: boolean; // Czy operacja zakończyła się sukcesem
  operationId: string; // ID operacji, której dotyczy wynik
  error?: string; // Opcjonalny komunikat błędu
  serverData?: unknown; // Dane zwrócone przez serwer (jeśli są)
  timestamp: number; // Czas zakończenia operacji
}

// Dane encji do synchronizacji z serwerem
export type SyncTaskListData = Omit<EncryptedTaskList, 'id' | 'user_id'>;
export type SyncTaskData = Omit<EncryptedTask, 'id' | 'task_list_id'>;
export type SyncSubTaskData = Omit<EncryptedSubTask, 'id' | 'task_id'>;

export interface DataConflict {
  entityType: EntityType; // Typ encji z konfliktem
  entityId: string; // ID encji z konfliktem
  localData: unknown; // Dane lokalne
  serverData: unknown; // Dane z serwera
  timestamp: number; // Czas wykrycia konfliktu
  resolved: boolean; // Czy konflikt został rozwiązany
  resolution?: 'local' | 'server' | 'merged'; // Typ rozwiązania konfliktu
}

export interface SyncOptions {
  force?: boolean; // Wymuś synchronizację mimo warunków
  entitiesOnly?: EntityType[]; // Synchronizuj tylko wybrane typy encji
  resolveDuplicates?: boolean; // Czy automatycznie rozwiązywać duplikaty
  resolveConflicts?: boolean; // Czy automatycznie rozwiązywać konflikty
  timeout?: number; // Limit czasu dla operacji synchronizacji (ms)
}
