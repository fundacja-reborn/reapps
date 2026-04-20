import { IndexedDBStore } from '../core/store';
import type { FolderEncrypted } from '@reborn/types';

/**
 * Folder store for RebornNotes application
 * TODO: Implement when RebornNotes functionality is added
 */
export const folderStore = new IndexedDBStore<FolderEncrypted>({
  storeName: 'folders',
  indexes: [
    { name: 'parent_id', keyPath: 'parent_id' },
    { name: 'is_archived', keyPath: 'is_archived' },
    { name: 'order_index', keyPath: 'order_index' }
  ]
});

/**
 * Helper queries for folders
 */
export const folderQueries = {
  /**
   * Get root folders (no parent)
   */
  getRootFolders: async (): Promise<FolderEncrypted[]> => {
    const all = await folderStore.getAll();
    return all
      .filter(folder => !folder.parent_id && !folder.is_archived)
      .sort((a, b) => a.order_index - b.order_index);
  },

  /**
   * Get child folders
   */
  getChildren: async (parentId: string): Promise<FolderEncrypted[]> => {
    const children = await folderStore.query('parent_id', parentId);
    return children
      .filter(folder => !folder.is_archived)
      .sort((a, b) => a.order_index - b.order_index);
  },

  /**
   * Get archived folders
   */
  getArchived: async (): Promise<FolderEncrypted[]> => {
    // IndexedDB does not support boolean keys in indexes, so we filter in memory
    const all = await folderStore.getAll();
    return all.filter(folder => folder.is_archived);
  },

  /**
   * Get folder tree structure
   */
  getFolderTree: async (): Promise<FolderTreeNode[]> => {
    const all = await folderStore.getAll();
    const activefolders = all.filter(f => !f.is_archived);
    
    // Build tree recursively
    const buildTree = (parentId: string | null): FolderTreeNode[] => {
      const folders = parentId 
        ? activefolders.filter(f => f.parent_id === parentId)
        : activefolders.filter(f => !f.parent_id);
      
      return folders
        .sort((a, b) => a.order_index - b.order_index)
        .map(folder => ({
          ...folder,
          children: buildTree(folder.id)
        }));
    };
    
    return buildTree(null);
  },

  /**
   * Get folder path (breadcrumb)
   */
  getFolderPath: async (folderId: string): Promise<FolderEncrypted[]> => {
    const path: FolderEncrypted[] = [];
    let currentId: string | null = folderId;
    
    while (currentId) {
      const folder = await folderStore.get(currentId);
      if (!folder) break;
      
      path.unshift(folder);
      currentId = folder.parent_id ?? null;
    }
    
    return path;
  },

  /**
   * Check if folder has children
   */
  hasChildren: async (folderId: string): Promise<boolean> => {
    const count = await folderStore.countByIndex('parent_id', folderId);
    return count > 0;
  }
};

/**
 * Folder operations
 */
export const folderOperations = {
  /**
   * Create folder with auto-ordering
   */
  createFolder: async (folder: Omit<FolderEncrypted, 'id' | 'order_index' | 'created_at' | 'updated_at'>): Promise<string> => {
    const siblings = folder.parent_id 
      ? await folderQueries.getChildren(folder.parent_id)
      : await folderQueries.getRootFolders();
    
    const maxOrder = Math.max(...siblings.map(s => s.order_index), -1);
    
    const newFolder: FolderEncrypted = {
      ...folder,
      id: crypto.randomUUID(),
      order_index: maxOrder + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    await folderStore.save(newFolder);
    return newFolder.id;
  },

  /**
   * Move folder to new parent
   */
  moveFolder: async (folderId: string, newParentId: string | null): Promise<void> => {
    const folder = await folderStore.get(folderId);
    if (!folder) throw new Error('Folder not found');
    
    // Check for circular reference
    if (newParentId) {
      const parentPath = await folderQueries.getFolderPath(newParentId);
      if (parentPath.some(f => f.id === folderId)) {
        throw new Error('Cannot move folder to its own descendant');
      }
    }
    
    // Get new siblings for ordering
    const newSiblings = newParentId 
      ? await folderQueries.getChildren(newParentId)
      : await folderQueries.getRootFolders();
    
    const maxOrder = Math.max(...newSiblings.map(s => s.order_index), -1);
    
    await folderStore.save({
      ...folder,
      parent_id: newParentId ?? undefined,
      order_index: maxOrder + 1,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Archive folder (and all subfolders)
   */
  archiveFolder: async (folderId: string): Promise<void> => {
    const folder = await folderStore.get(folderId);
    if (!folder) throw new Error('Folder not found');
    
    // Archive the folder
    await folderStore.save({
      ...folder,
      is_archived: true,
      updated_at: new Date().toISOString()
    });
    
    // Recursively archive all subfolders
    const children = await folderQueries.getChildren(folderId);
    for (const child of children) {
      await folderOperations.archiveFolder(child.id);
    }
  },

  /**
   * Restore archived folder
   */
  restoreFolder: async (folderId: string): Promise<void> => {
    const folder = await folderStore.get(folderId);
    if (!folder) throw new Error('Folder not found');
    
    await folderStore.save({
      ...folder,
      is_archived: false,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Reorder folders
   */
  reorderFolders: async (parentId: string | null, folderIds: string[]): Promise<void> => {
    const folders = await folderStore.getMany(folderIds);
    const updated = folders.map((folder, index) => ({
      ...folder,
      order_index: index,
      updated_at: new Date().toISOString()
    }));
    await folderStore.saveMany(updated);
  },

  /**
   * Delete folder
   * Note: Validation and cascading deletes should be handled by the application layer
   * to avoid circular dependencies between stores
   */
  deleteFolder: async (folderId: string): Promise<void> => {
    await folderStore.delete(folderId);
  },
  
  /**
   * Check if folder can be deleted (has no children)
   */
  canDeleteFolder: async (folderId: string): Promise<boolean> => {
    const hasChildren = await folderQueries.hasChildren(folderId);
    return !hasChildren;
  },
  
  /**
   * Recursively get all descendant folder IDs
   */
  getDescendantIds: async (folderId: string): Promise<string[]> => {
    const descendants: string[] = [];
    const children = await folderQueries.getChildren(folderId);
    
    for (const child of children) {
      descendants.push(child.id);
      const childDescendants = await folderOperations.getDescendantIds(child.id);
      descendants.push(...childDescendants);
    }
    
    return descendants;
  }
};

/**
 * Type for folder tree structure
 */
interface FolderTreeNode extends FolderEncrypted {
  children: FolderTreeNode[];
}
