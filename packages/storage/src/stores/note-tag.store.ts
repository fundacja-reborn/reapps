import { IndexedDBStore } from '../core/store';
import type { NoteTag as BaseNoteTag } from '@reborn/types';

/**
 * Extended NoteTag with id and updated_at for store management
 */
export interface NoteTag extends BaseNoteTag {
  id: string;
  updated_at?: string;
}

/**
 * Note-Tag relationship store for RebornNotes application
 * TODO: Implement when RebornNotes functionality is added
 */
export const noteTagStore = new IndexedDBStore<NoteTag>({
  storeName: 'noteTags',
  indexes: [
    { name: 'note_id', keyPath: 'note_id' },
    { name: 'tag_id', keyPath: 'tag_id' },
    { name: 'composite', keyPath: ['note_id', 'tag_id'], unique: true }
  ]
});

/**
 * Helper queries for note-tag relationships
 */
export const noteTagQueries = {
  /**
   * Get all tags for a note
   */
  getTagsForNote: async (noteId: string): Promise<string[]> => {
    const relationships = await noteTagStore.query('note_id', noteId);
    return relationships.map(rel => rel.tag_id);
  },

  /**
   * Get all notes for a tag
   */
  getNotesForTag: async (tagId: string): Promise<string[]> => {
    const relationships = await noteTagStore.query('tag_id', tagId);
    return relationships.map(rel => rel.note_id);
  },

  /**
   * Check if note has tag
   */
  noteHasTag: async (noteId: string, tagId: string): Promise<boolean> => {
    const relationships = await noteTagStore.query('note_id', noteId);
    return relationships.some(rel => rel.tag_id === tagId);
  },

  /**
   * Get notes with multiple tags (AND operation)
   */
  getNotesWithAllTags: async (tagIds: string[]): Promise<string[]> => {
    if (tagIds.length === 0) return [];
    
    // Get notes for first tag
    let noteIds = await noteTagQueries.getNotesForTag(tagIds[0]);
    
    // Filter by remaining tags
    for (let i = 1; i < tagIds.length; i++) {
      const notesForTag = await noteTagQueries.getNotesForTag(tagIds[i]);
      noteIds = noteIds.filter(noteId => notesForTag.includes(noteId));
    }
    
    return [...new Set(noteIds)];
  },

  /**
   * Get notes with any of the tags (OR operation)
   */
  getNotesWithAnyTag: async (tagIds: string[]): Promise<string[]> => {
    const allNoteIds = new Set<string>();
    
    for (const tagId of tagIds) {
      const noteIds = await noteTagQueries.getNotesForTag(tagId);
      noteIds.forEach(id => allNoteIds.add(id));
    }
    
    return Array.from(allNoteIds);
  },

  /**
   * Count notes per tag
   */
  countNotesPerTag: async (): Promise<Map<string, number>> => {
    const all = await noteTagStore.getAll();
    const counts = new Map<string, number>();
    
    for (const rel of all) {
      counts.set(rel.tag_id, (counts.get(rel.tag_id) || 0) + 1);
    }
    
    return counts;
  }
};

/**
 * Note-tag operations
 */
export const noteTagOperations = {
  /**
   * Add tag to note
   * Note: Tag usage count should be updated by the application layer
   */
  addTagToNote: async (noteId: string, tagId: string): Promise<void> => {
    // Check if relationship already exists
    const exists = await noteTagQueries.noteHasTag(noteId, tagId);
    if (exists) return;

    const relationship: NoteTag = {
      id: crypto.randomUUID(),
      note_id: noteId,
      tag_id: tagId,
      created_at: new Date().toISOString()
    };

    await noteTagStore.save(relationship);
  },

  /**
   * Remove tag from note
   * Note: Tag usage count should be updated by the application layer
   */
  removeTagFromNote: async (noteId: string, tagId: string): Promise<void> => {
    const relationships = await noteTagStore.query('note_id', noteId);
    const rel = relationships.find(r => r.tag_id === tagId);
    
    if (rel) {
      await noteTagStore.delete(rel.id);
    }
  },

  /**
   * Update all tags for a note
   */
  updateNoteTags: async (noteId: string, tagIds: string[]): Promise<void> => {
    // Get current tags
    const currentRelationships = await noteTagStore.query('note_id', noteId);
    const currentTagIds = currentRelationships.map(r => r.tag_id);
    
    // Determine tags to add and remove
    const toAdd = tagIds.filter(id => !currentTagIds.includes(id));
    const toRemove = currentTagIds.filter(id => !tagIds.includes(id));
    
    // Add new tags
    for (const tagId of toAdd) {
      await noteTagOperations.addTagToNote(noteId, tagId);
    }
    
    // Remove old tags
    for (const tagId of toRemove) {
      await noteTagOperations.removeTagFromNote(noteId, tagId);
    }
  },

  /**
   * Remove all tags from a note
   * Note: Tag usage counts should be updated by the application layer
   */
  removeAllTagsFromNote: async (noteId: string): Promise<string[]> => {
    const relationships = await noteTagStore.query('note_id', noteId);
    const tagIds = relationships.map(r => r.tag_id);
    
    await noteTagStore.deleteMany(relationships.map(r => r.id));
    
    // Return removed tag IDs so application layer can update counts
    return tagIds;
  },

  /**
   * Remove all notes from a tag (before deleting tag)
   */
  removeAllNotesFromTag: async (tagId: string): Promise<void> => {
    const relationships = await noteTagStore.query('tag_id', tagId);
    await noteTagStore.deleteMany(relationships.map(r => r.id));
  },

  /**
   * Copy tags from one note to another
   */
  copyTags: async (sourceNoteId: string, targetNoteId: string): Promise<void> => {
    const tagIds = await noteTagQueries.getTagsForNote(sourceNoteId);
    
    for (const tagId of tagIds) {
      await noteTagOperations.addTagToNote(targetNoteId, tagId);
    }
  }
};
