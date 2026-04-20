import { IndexedDBStore } from '../core/store';
import type { TagEncrypted as BaseTagEncrypted } from '@reborn/types';

/**
 * Extended TagEncrypted with usage tracking fields
 */
export interface TagEncrypted extends BaseTagEncrypted {
  usage_count?: number;
  last_used_at?: string;
}

/**
 * Tag store for RebornNotes application
 * TODO: Implement when RebornNotes functionality is added
 */
export const tagStore = new IndexedDBStore<TagEncrypted>({
  storeName: 'tags',
  indexes: [
    { name: 'name_encrypted', keyPath: 'name_encrypted' }
  ]
});

/**
 * Helper queries for tags
 */
export const tagQueries = {
  /**
   * Get all tags sorted by usage count
   */
  getMostUsed: async (limit?: number): Promise<TagEncrypted[]> => {
    const tags = await tagStore.getAll();
    const sorted = tags.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
    return limit ? sorted.slice(0, limit) : sorted;
  },

  /**
   * Search tags by encrypted name (requires decryption in service layer)
   * This returns all tags - actual filtering happens after decryption
   */
  searchByName: async (): Promise<TagEncrypted[]> => {
    // Since names are encrypted, we can't search directly
    // Return all tags for decryption and filtering in service layer
    return tagStore.getAll();
  },

  /**
   * Get tags by encrypted color
   */
  getByColor: async (colorEncrypted: string): Promise<TagEncrypted[]> => {
    const all = await tagStore.getAll();
    return all.filter(tag => tag.color_encrypted === colorEncrypted);
  },

  /**
   * Get tag statistics
   */
  getStatistics: async (): Promise<TagStatistics> => {
    const tags = await tagStore.getAll();
    const totalUsage = tags.reduce((sum, tag) => sum + (tag.usage_count || 0), 0);
    
    return {
      totalTags: tags.length,
      totalUsage,
      averageUsage: tags.length > 0 ? totalUsage / tags.length : 0,
      mostUsedTag: tags.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))[0] || null
    };
  }
};

/**
 * Tag operations
 */
export const tagOperations = {
  /**
   * Create or update tag
   */
  saveTag: async (tag: TagEncrypted): Promise<void> => {
    await tagStore.save({
      ...tag,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Increment usage count
   */
  incrementUsage: async (tagId: string): Promise<void> => {
    const tag = await tagStore.get(tagId);
    if (!tag) throw new Error('Tag not found');

    await tagStore.save({
      ...tag,
      usage_count: (tag.usage_count || 0) + 1,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Decrement usage count
   */
  decrementUsage: async (tagId: string): Promise<void> => {
    const tag = await tagStore.get(tagId);
    if (!tag) throw new Error('Tag not found');

    const newCount = Math.max(0, (tag.usage_count || 0) - 1);
    await tagStore.save({
      ...tag,
      usage_count: newCount,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Update tag usage count (should be updated together with tag data)
   */
  updateTagCounts: async (tagId: string, usageCount: number): Promise<void> => {
    const tag = await tagStore.get(tagId);
    if (!tag) throw new Error('Tag not found');

    await tagStore.save({
      ...tag,
      usage_count: usageCount,
      last_used_at: usageCount > (tag.usage_count || 0) ? new Date().toISOString() : tag.last_used_at,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Merge tags metadata only
   * Note: Note-tag relationships should be updated by the application layer
   */
  mergeTagsMetadata: async (sourceTagId: string, targetTagId: string): Promise<number> => {
    if (sourceTagId === targetTagId) {
      throw new Error('Cannot merge tag with itself');
    }

    const sourceTag = await tagStore.get(sourceTagId);
    const targetTag = await tagStore.get(targetTagId);
    
    if (!sourceTag || !targetTag) {
      throw new Error('One or both tags not found');
    }

    const sourceCount = sourceTag.usage_count || 0;
    const targetCount = targetTag.usage_count || 0;
    const newCount = sourceCount + targetCount;

    // Update target tag usage count
    await tagStore.save({
      ...targetTag,
      usage_count: newCount,
      updated_at: new Date().toISOString()
    });

    // Delete source tag
    await tagStore.delete(sourceTagId);
    
    // Return the source count so app layer knows how many relationships to update
    return sourceCount;
  },

  /**
   * Delete unused tags
   */
  cleanupUnused: async (): Promise<number> => {
    const tags = await tagStore.getAll();
    const unused = tags.filter(tag => !tag.usage_count || tag.usage_count === 0);
    
    await tagStore.deleteMany(unused.map(t => t.id));
    return unused.length;
  }
};

/**
 * Type for tag statistics
 */
interface TagStatistics {
  totalTags: number;
  totalUsage: number;
  averageUsage: number;
  mostUsedTag: TagEncrypted | null;
}
