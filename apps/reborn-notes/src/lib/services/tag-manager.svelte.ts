import { tagsStore } from '$lib/stores/tags.store';

/**
 * Reactive tag management state & logic (Svelte 5 runes).
 *
 * Encapsulates: search, create, rename, delete, color picker,
 * mobile action sheet — everything that was inline in +page.svelte.
 *
 * Note: filteredTags and activeMenuTag are $derived in .svelte components
 * because $tagsStore auto-subscription is only available there.
 */
class TagManager {
  // ── Search / create ──────────────────────────────────────────
  tagSearch = $state('');
  creatingTag = $state(false);
  newTagName = $state('');

  // ── Context menu ─────────────────────────────────────────────
  tagMenuId = $state<string | null>(null);
  tagActionSheetOpen = $state(false);

  // ── Rename ───────────────────────────────────────────────────
  renamingTagId = $state<string | null>(null);
  renameTagValue = $state('');
  renameTagInputEl = $state<HTMLInputElement | null>(null);

  // ── Delete ───────────────────────────────────────────────────
  deleteTagDialogOpen = $state(false);
  tagToDelete = $state<string | null>(null);

  // ── Color picker ─────────────────────────────────────────────
  colorPickerTagId = $state<string | null>(null);

  // ── Actions ──────────────────────────────────────────────────

  async handleCreateTag() {
    const name = this.newTagName.trim();
    if (!name) return;
    await tagsStore.create(name);
    this.newTagName = '';
    this.creatingTag = false;
  }

  openTagMenu(tagId: string, isMobile: boolean, e?: MouseEvent) {
    e?.stopPropagation();
    if (this.tagMenuId === tagId) {
      this.closeTagMenu();
      return;
    }
    this.tagMenuId = tagId;
    if (isMobile) {
      this.tagActionSheetOpen = true;
    }
  }

  closeTagMenu() {
    this.tagMenuId = null;
    this.tagActionSheetOpen = false;
  }

  startRenameTag(tagId: string, currentName: string) {
    this.closeTagMenu();
    this.renamingTagId = tagId;
    this.renameTagValue = currentName;
    setTimeout(() => this.renameTagInputEl?.select(), 100);
  }

  async commitRenameTag(tagId: string) {
    const name = this.renameTagValue.trim();
    if (name) await tagsStore.rename(tagId, name);
    this.renamingTagId = null;
  }

  handleDeleteTag(tagId: string) {
    this.tagToDelete = tagId;
    this.closeTagMenu();
    this.deleteTagDialogOpen = true;
  }

  async confirmDeleteTag(activeTagId: string | null, clearActiveTag: () => void) {
    if (this.tagToDelete) {
      if (activeTagId === this.tagToDelete) clearActiveTag();
      await tagsStore.remove(this.tagToDelete);
    }
    this.tagToDelete = null;
  }

  startColorPicker(tagId: string) {
    this.closeTagMenu();
    // Delay to avoid svelte:window onclick handler clearing colorPickerTagId
    setTimeout(() => {
      this.colorPickerTagId = tagId;
    }, 0);
  }

  async setTagColor(tagId: string, color: string | undefined) {
    await tagsStore.updateColor(tagId, color);
    this.colorPickerTagId = null;
  }

  /** Reset tag-related state when leaving the tags section. */
  resetSection() {
    this.tagSearch = '';
    this.creatingTag = false;
    this.newTagName = '';
  }
}

export const tagManager = new TagManager();
