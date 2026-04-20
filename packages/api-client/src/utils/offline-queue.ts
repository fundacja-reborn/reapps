import type { QueuedRequest } from '../types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('OfflineQueue');

/**
 * Manages offline request queue
 */
export class OfflineQueue {
  private readonly STORAGE_KEY = 'reborn_offline_queue';
  private readonly MAX_RETRIES = 3;
  private readonly SYNC_KEY = 'reborn_last_sync';

  /**
   * Add request to queue
   */
  async add(request: QueuedRequest): Promise<void> {
    const queue = await this.getAll();
    queue.push(request);
    await this.save(queue);
    logger.info(`Queued request ${request.id} for offline sync`);
  }

  /**
   * Get all queued requests
   */
  async getAll(): Promise<QueuedRequest[]> {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      logger.error('Failed to load offline queue:', error);
      return [];
    }
  }

  /**
   * Remove request from queue
   */
  async remove(id: string): Promise<void> {
    const queue = await this.getAll();
    const filtered = queue.filter(item => item.id !== id);
    await this.save(filtered);
    logger.info(`Removed request ${id} from offline queue`);
  }

  /**
   * Increment retry count for a request
   */
  async incrementRetries(id: string): Promise<void> {
    const queue = await this.getAll();
    const item = queue.find(req => req.id === id);
    
    if (item) {
      item.retries++;
      
      if (item.retries >= this.MAX_RETRIES) {
        logger.warn(`Request ${id} exceeded max retries, removing from queue`);
        await this.remove(id);
      } else {
        await this.save(queue);
      }
    }
  }

  /**
   * Clear all queued requests
   */
  async clear(): Promise<void> {
    await this.save([]);
    logger.info('Cleared offline queue');
  }

  /**
   * Get requests by entity type
   */
  async getByEntityType(entityType: string): Promise<QueuedRequest[]> {
    const queue = await this.getAll();
    return queue.filter(item => item.entityType === entityType);
  }

  /**
   * Get requests by entity ID
   */
  async getByEntityId(entityId: string): Promise<QueuedRequest[]> {
    const queue = await this.getAll();
    return queue.filter(item => item.entityId === entityId);
  }

  /**
   * Get last sync time
   */
  async getLastSyncTime(): Promise<string | undefined> {
    if (typeof window === 'undefined') {
      return undefined;
    }

    return localStorage.getItem(this.SYNC_KEY) || undefined;
  }

  /**
   * Update last sync time
   */
  async updateLastSyncTime(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(this.SYNC_KEY, new Date().toISOString());
  }

  /**
   * Get queue size
   */
  async size(): Promise<number> {
    const queue = await this.getAll();
    return queue.length;
  }

  /**
   * Check if queue has pending requests
   */
  async hasPending(): Promise<boolean> {
    const size = await this.size();
    return size > 0;
  }

  /**
   * Get failed requests
   */
  async getFailed(): Promise<QueuedRequest[]> {
    const queue = await this.getAll();
    return queue.filter(item => item.retries > 0);
  }

  /**
   * Requeue failed requests
   */
  async requeueFailed(): Promise<void> {
    const queue = await this.getAll();
    
    for (const item of queue) {
      if (item.retries > 0) {
        item.retries = 0;
      }
    }
    
    await this.save(queue);
    logger.info('Requeued all failed requests');
  }

  /**
   * Save queue to storage
   */
  private async save(queue: QueuedRequest[]): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(queue));
    } catch (error) {
      logger.error('Failed to save offline queue:', error);
      
      // If storage is full, try to remove old items
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        logger.warn('Storage quota exceeded, removing old items');
        const sorted = queue.sort((a, b) => b.timestamp - a.timestamp);
        const reduced = sorted.slice(0, Math.floor(sorted.length * 0.8));
        
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(reduced));
        } catch (retryError) {
          logger.error('Failed to save reduced queue:', retryError);
        }
      }
    }
  }

  /**
   * Export queue for debugging
   */
  async export(): Promise<string> {
    const queue = await this.getAll();
    return JSON.stringify(queue, null, 2);
  }

  /**
   * Import queue (for testing/debugging)
   */
  async import(data: string): Promise<void> {
    try {
      const queue = JSON.parse(data) as QueuedRequest[];
      await this.save(queue);
      logger.info(`Imported ${queue.length} requests to offline queue`);
    } catch (error) {
      logger.error('Failed to import queue:', error);
      throw new Error('Invalid queue data');
    }
  }
}
