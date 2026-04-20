import { ApiClient } from '../core/client';
import type { ApiResponse } from '../types';
import type { NoteEncrypted, FolderEncrypted, TagEncrypted } from '@reborn/types';

/**
 * Note query parameters
 */
export interface NoteQueryParams {
  folderId?: string;
  tagIds?: string[];
  search?: string;
  orderBy?: 'created_at' | 'updated_at' | 'title';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Note endpoints
 */
export class NoteEndpoints {
  constructor(private client: ApiClient) {}

  /**
   * Get all notes
   */
  async getAll(params?: NoteQueryParams): Promise<ApiResponse<NoteEncrypted[]>> {
    const queryString = this.buildQueryString(params);
    return this.client.get<NoteEncrypted[]>(`/notes${queryString}`);
  }

  /**
   * Get note by ID
   */
  async getById(id: string): Promise<ApiResponse<NoteEncrypted>> {
    const serverId = await this.client.resolveId(id, 'note');
    return this.client.get<NoteEncrypted>(`/notes/${serverId}`);
  }

  /**
   * Create new note
   */
  async create(note: NoteEncrypted): Promise<ApiResponse<NoteEncrypted>> {
    const response = await this.client.post<NoteEncrypted>('/notes', note);
    
    // Save ID mapping
    if (response.success && response.data && response.data.id !== note.id) {
      await this.client.saveIdMapping({
        localId: note.id,
        serverId: response.data.id,
        entityType: 'note',
        createdAt: new Date().toISOString()
      });
    }
    
    return response;
  }

  /**
   * Update note
   */
  async update(id: string, updates: Partial<NoteEncrypted>): Promise<ApiResponse<NoteEncrypted>> {
    const serverId = await this.client.resolveId(id, 'note');
    return this.client.put<NoteEncrypted>(`/notes/${serverId}`, updates);
  }

  /**
   * Delete note
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    const serverId = await this.client.resolveId(id, 'note');
    return this.client.delete<void>(`/notes/${serverId}`);
  }

  /**
   * Move note to folder
   */
  async moveToFolder(noteId: string, folderId: string | null): Promise<ApiResponse<NoteEncrypted>> {
    const serverNoteId = await this.client.resolveId(noteId, 'note');
    const serverFolderId = folderId ? await this.client.resolveId(folderId, 'folder') : null;
    
    return this.client.patch<NoteEncrypted>(
      `/notes/${serverNoteId}/move`,
      { folderId: serverFolderId }
    );
  }

  /**
   * Add tags to note
   */
  async addTags(noteId: string, tagIds: string[]): Promise<ApiResponse<NoteEncrypted>> {
    const serverNoteId = await this.client.resolveId(noteId, 'note');
    const serverTagIds = await Promise.all(
      tagIds.map(id => this.client.resolveId(id, 'tag'))
    );
    
    return this.client.post<NoteEncrypted>(
      `/notes/${serverNoteId}/tags`,
      { tagIds: serverTagIds }
    );
  }

  /**
   * Remove tags from note
   */
  async removeTags(noteId: string, tagIds: string[]): Promise<ApiResponse<NoteEncrypted>> {
    const serverNoteId = await this.client.resolveId(noteId, 'note');
    const serverTagIds = await Promise.all(
      tagIds.map(id => this.client.resolveId(id, 'tag'))
    );
    
    return this.client.delete<NoteEncrypted>(
      `/notes/${serverNoteId}/tags`,
      { body: JSON.stringify({ tagIds: serverTagIds }) }
    );
  }

  /**
   * Search notes
   */
  async search(query: string, options?: {
    folderId?: string;
    tagIds?: string[];
    limit?: number;
  }): Promise<ApiResponse<NoteEncrypted[]>> {
    const params: any = { q: query };
    
    if (options?.folderId) {
      params.folderId = await this.client.resolveId(options.folderId, 'folder');
    }
    
    if (options?.tagIds) {
      params.tagIds = await Promise.all(
        options.tagIds.map(id => this.client.resolveId(id, 'tag'))
      );
    }
    
    if (options?.limit) {
      params.limit = options.limit;
    }
    
    const queryString = new URLSearchParams(params).toString();
    return this.client.get<NoteEncrypted[]>(`/notes/search?${queryString}`);
  }

  /**
   * Get note history
   */
  async getHistory(noteId: string): Promise<ApiResponse<Array<{
    id: string;
    noteId: string;
    content_encrypted: string;
    createdAt: string;
    metadata_encrypted?: string;
  }>>> {
    const serverId = await this.client.resolveId(noteId, 'note');
    return this.client.get(`/notes/${serverId}/history`);
  }

  /**
   * Restore note from history
   */
  async restoreFromHistory(noteId: string, historyId: string): Promise<ApiResponse<NoteEncrypted>> {
    const serverId = await this.client.resolveId(noteId, 'note');
    return this.client.post<NoteEncrypted>(
      `/notes/${serverId}/restore`,
      { historyId }
    );
  }

  /**
   * Build query string
   */
  private buildQueryString(params?: NoteQueryParams): string {
    if (!params) return '';
    
    const searchParams = new URLSearchParams();
    
    if (params.folderId) searchParams.append('folderId', params.folderId);
    if (params.tagIds?.length) searchParams.append('tagIds', params.tagIds.join(','));
    if (params.search) searchParams.append('search', params.search);
    if (params.orderBy) searchParams.append('orderBy', params.orderBy);
    if (params.order) searchParams.append('order', params.order);
    if (params.limit) searchParams.append('limit', params.limit.toString());
    if (params.offset) searchParams.append('offset', params.offset.toString());
    
    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }
}

/**
 * Folder endpoints
 */
export class FolderEndpoints {
  constructor(private client: ApiClient) {}

  /**
   * Get all folders
   */
  async getAll(): Promise<ApiResponse<FolderEncrypted[]>> {
    return this.client.get<FolderEncrypted[]>('/folders');
  }

  /**
   * Get folder by ID
   */
  async getById(id: string): Promise<ApiResponse<FolderEncrypted>> {
    const serverId = await this.client.resolveId(id, 'folder');
    return this.client.get<FolderEncrypted>(`/folders/${serverId}`);
  }

  /**
   * Create folder
   */
  async create(folder: FolderEncrypted): Promise<ApiResponse<FolderEncrypted>> {
    const response = await this.client.post<FolderEncrypted>('/folders', folder);
    
    if (response.success && response.data && response.data.id !== folder.id) {
      await this.client.saveIdMapping({
        localId: folder.id,
        serverId: response.data.id,
        entityType: 'folder',
        createdAt: new Date().toISOString()
      });
    }
    
    return response;
  }

  /**
   * Update folder
   */
  async update(id: string, updates: Partial<FolderEncrypted>): Promise<ApiResponse<FolderEncrypted>> {
    const serverId = await this.client.resolveId(id, 'folder');
    return this.client.put<FolderEncrypted>(`/folders/${serverId}`, updates);
  }

  /**
   * Delete folder
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    const serverId = await this.client.resolveId(id, 'folder');
    return this.client.delete<void>(`/folders/${serverId}`);
  }

  /**
   * Move folder
   */
  async move(folderId: string, parentId: string | null): Promise<ApiResponse<FolderEncrypted>> {
    const serverFolderId = await this.client.resolveId(folderId, 'folder');
    const serverParentId = parentId ? await this.client.resolveId(parentId, 'folder') : null;
    
    return this.client.patch<FolderEncrypted>(
      `/folders/${serverFolderId}/move`,
      { parentId: serverParentId }
    );
  }

  /**
   * Get folder tree
   */
  async getTree(): Promise<ApiResponse<FolderEncrypted[]>> {
    return this.client.get<FolderEncrypted[]>('/folders/tree');
  }
}

/**
 * Tag endpoints
 */
export class TagEndpoints {
  constructor(private client: ApiClient) {}

  /**
   * Get all tags
   */
  async getAll(): Promise<ApiResponse<TagEncrypted[]>> {
    return this.client.get<TagEncrypted[]>('/tags');
  }

  /**
   * Get tag by ID
   */
  async getById(id: string): Promise<ApiResponse<TagEncrypted>> {
    const serverId = await this.client.resolveId(id, 'tag');
    return this.client.get<TagEncrypted>(`/tags/${serverId}`);
  }

  /**
   * Create tag
   */
  async create(tag: TagEncrypted): Promise<ApiResponse<TagEncrypted>> {
    const response = await this.client.post<TagEncrypted>('/tags', tag);
    
    if (response.success && response.data && response.data.id !== tag.id) {
      await this.client.saveIdMapping({
        localId: tag.id,
        serverId: response.data.id,
        entityType: 'tag',
        createdAt: new Date().toISOString()
      });
    }
    
    return response;
  }

  /**
   * Update tag
   */
  async update(id: string, updates: Partial<TagEncrypted>): Promise<ApiResponse<TagEncrypted>> {
    const serverId = await this.client.resolveId(id, 'tag');
    return this.client.put<TagEncrypted>(`/tags/${serverId}`, updates);
  }

  /**
   * Delete tag
   */
  async delete(id: string): Promise<ApiResponse<void>> {
    const serverId = await this.client.resolveId(id, 'tag');
    return this.client.delete<void>(`/tags/${serverId}`);
  }

  /**
   * Merge tags
   */
  async merge(sourceTagId: string, targetTagId: string): Promise<ApiResponse<TagEncrypted>> {
    const serverSourceId = await this.client.resolveId(sourceTagId, 'tag');
    const serverTargetId = await this.client.resolveId(targetTagId, 'tag');
    
    return this.client.post<TagEncrypted>('/tags/merge', {
      sourceId: serverSourceId,
      targetId: serverTargetId
    });
  }
}
