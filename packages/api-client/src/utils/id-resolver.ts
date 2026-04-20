import type { EntityType, IdMapping } from '../types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('IdResolver');

/**
 * Resolves local IDs to server IDs
 */
export class IdResolver {
  private readonly STORAGE_KEY = 'reborn_id_mappings';
  private cache = new Map<string, string>();

  /**
   * Resolve local ID to server ID
   */
  async resolve(localId: string, entityType: EntityType): Promise<string> {
    // Check cache first
    const cacheKey = `${entityType}:${localId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Check storage
    const mappings = await this.getAllMappings();
    const mapping = mappings.find(
      m => m.localId === localId && m.entityType === entityType
    );

    if (mapping) {
      this.cache.set(cacheKey, mapping.serverId);
      return mapping.serverId;
    }

    // No mapping found, return original ID
    return localId;
  }

  /**
   * Resolve multiple IDs at once
   */
  async resolveMany(
    ids: string[],
    entityType: EntityType
  ): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    const mappings = await this.getAllMappings();

    for (const id of ids) {
      const cacheKey = `${entityType}:${id}`;
      
      // Check cache
      if (this.cache.has(cacheKey)) {
        resolved.set(id, this.cache.get(cacheKey)!);
        continue;
      }

      // Check mappings
      const mapping = mappings.find(
        m => m.localId === id && m.entityType === entityType
      );

      if (mapping) {
        resolved.set(id, mapping.serverId);
        this.cache.set(cacheKey, mapping.serverId);
      } else {
        resolved.set(id, id);
      }
    }

    return resolved;
  }

  /**
   * Save ID mapping
   */
  async saveMapping(mapping: IdMapping): Promise<void> {
    const mappings = await this.getAllMappings();
    
    // Check if mapping already exists
    const existingIndex = mappings.findIndex(
      m => m.localId === mapping.localId && m.entityType === mapping.entityType
    );

    if (existingIndex >= 0) {
      // Update existing mapping
      mappings[existingIndex] = mapping;
    } else {
      // Add new mapping
      mappings.push(mapping);
    }

    await this.saveMappings(mappings);
    
    // Update cache
    const cacheKey = `${mapping.entityType}:${mapping.localId}`;
    this.cache.set(cacheKey, mapping.serverId);
    
    logger.debug(`Saved ID mapping: ${mapping.localId} -> ${mapping.serverId} (${mapping.entityType})`);
  }

  /**
   * Save multiple mappings at once
   */
  async saveManyMappings(mappings: IdMapping[]): Promise<void> {
    const allMappings = await this.getAllMappings();
    
    for (const mapping of mappings) {
      const existingIndex = allMappings.findIndex(
        m => m.localId === mapping.localId && m.entityType === mapping.entityType
      );

      if (existingIndex >= 0) {
        allMappings[existingIndex] = mapping;
      } else {
        allMappings.push(mapping);
      }

      // Update cache
      const cacheKey = `${mapping.entityType}:${mapping.localId}`;
      this.cache.set(cacheKey, mapping.serverId);
    }

    await this.saveMappings(allMappings);
    logger.debug(`Saved ${mappings.length} ID mappings`);
  }

  /**
   * Get mapping by local ID
   */
  async getMapping(
    localId: string,
    entityType: EntityType
  ): Promise<IdMapping | undefined> {
    const mappings = await this.getAllMappings();
    return mappings.find(
      m => m.localId === localId && m.entityType === entityType
    );
  }

  /**
   * Get reverse mapping (server ID to local ID)
   */
  async getReverseMapping(
    serverId: string,
    entityType: EntityType
  ): Promise<string | undefined> {
    const mappings = await this.getAllMappings();
    const mapping = mappings.find(
      m => m.serverId === serverId && m.entityType === entityType
    );
    return mapping?.localId;
  }

  /**
   * Remove mapping
   */
  async removeMapping(localId: string, entityType: EntityType): Promise<void> {
    const mappings = await this.getAllMappings();
    const filtered = mappings.filter(
      m => !(m.localId === localId && m.entityType === entityType)
    );
    
    await this.saveMappings(filtered);
    
    // Remove from cache
    const cacheKey = `${entityType}:${localId}`;
    this.cache.delete(cacheKey);
    
    logger.debug(`Removed ID mapping for ${localId} (${entityType})`);
  }

  /**
   * Clear all mappings for an entity type
   */
  async clearEntityTypeMappings(entityType: EntityType): Promise<void> {
    const mappings = await this.getAllMappings();
    const filtered = mappings.filter(m => m.entityType !== entityType);
    
    await this.saveMappings(filtered);
    
    // Clear cache entries
    for (const [key] of this.cache) {
      if (key.startsWith(`${entityType}:`)) {
        this.cache.delete(key);
      }
    }
    
    logger.info(`Cleared all ID mappings for entity type: ${entityType}`);
  }

  /**
   * Clear all mappings
   */
  async clearAll(): Promise<void> {
    await this.saveMappings([]);
    this.cache.clear();
    logger.info('Cleared all ID mappings');
  }

  /**
   * Get all mappings
   */
  private async getAllMappings(): Promise<IdMapping[]> {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      logger.error('Failed to load ID mappings:', error);
      return [];
    }
  }

  /**
   * Save mappings to storage
   */
  private async saveMappings(mappings: IdMapping[]): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(mappings));
    } catch (error) {
      logger.error('Failed to save ID mappings:', error);
      
      // If storage is full, try to remove old mappings
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        logger.warn('Storage quota exceeded, removing old mappings');
        
        // Sort by creation date and keep only recent mappings
        const sorted = mappings.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const reduced = sorted.slice(0, Math.floor(sorted.length * 0.8));
        
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(reduced));
        } catch (retryError) {
          logger.error('Failed to save reduced mappings:', retryError);
        }
      }
    }
  }

  /**
   * Export mappings for debugging
   */
  async export(): Promise<string> {
    const mappings = await this.getAllMappings();
    return JSON.stringify(mappings, null, 2);
  }

  /**
   * Import mappings (for testing/debugging)
   */
  async import(data: string): Promise<void> {
    try {
      const mappings = JSON.parse(data) as IdMapping[];
      await this.saveMappings(mappings);
      
      // Update cache
      for (const mapping of mappings) {
        const cacheKey = `${mapping.entityType}:${mapping.localId}`;
        this.cache.set(cacheKey, mapping.serverId);
      }
      
      logger.info(`Imported ${mappings.length} ID mappings`);
    } catch (error) {
      logger.error('Failed to import mappings:', error);
      throw new Error('Invalid mapping data');
    }
  }

  /**
   * Get statistics about mappings
   */
  async getStats(): Promise<Record<EntityType, number>> {
    const mappings = await this.getAllMappings();
    const stats: Partial<Record<EntityType, number>> = {};
    
    for (const mapping of mappings) {
      stats[mapping.entityType] = (stats[mapping.entityType] || 0) + 1;
    }
    
    return stats as Record<EntityType, number>;
  }
}
