<script lang="ts">
  import { Folder, ChevronRight } from '@lucide/svelte';
  import type { FolderWithChildren } from '@reborn/types';
  import { t } from '$lib/stores/i18n.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import { pendingNewFolderDraft } from '$lib/stores/new-folder-draft.store';

  let {
    subfolders,
    parentId = null,
    onselect
  }: {
    subfolders: FolderWithChildren[];
    /** ID of the folder this list belongs to; used to match against an active new-folder draft. */
    parentId?: string | null;
    onselect: (id: string) => void;
  } = $props();

  // ── Inline new-folder draft ─────────────────────────────────────
  // Renders an editable input row at the very top when a draft was requested
  // for this folder (via the "+ subfolder" header button). Folder is created
  // on commit (Enter / blur with non-empty value); Escape drops the draft.
  let draftName = $state('');
  let draftInputEl = $state<HTMLInputElement | undefined>(undefined);
  const showDraft = $derived(
    parentId !== null && $pendingNewFolderDraft?.parentId === parentId
  );

  $effect(() => {
    if (showDraft) {
      draftName = $t('folders.new_folder');
      setTimeout(() => {
        draftInputEl?.scrollIntoView({ block: 'nearest' });
        draftInputEl?.select();
      }, 0);
    }
  });

  async function commitDraft() {
    // Guard against re-entry: Enter and Escape both clear the store, which
    // removes the input from the DOM. The browser then fires a blur event on
    // the removed node, which would otherwise call commitDraft a second time.
    if (!$pendingNewFolderDraft) return;
    const trimmed = draftName.trim();
    pendingNewFolderDraft.set(null);
    if (trimmed && parentId) {
      await foldersStore.create(trimmed, parentId);
    }
  }

  function cancelDraft() {
    pendingNewFolderDraft.set(null);
  }
</script>

{#if subfolders.length > 0 || showDraft}
  <div class="mb-3 flex flex-col gap-1">
    <h2
      class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      {$t('folders.subfolders')}
    </h2>
    <ul class="flex flex-col gap-1" role="list">
      {#if showDraft}
        <li>
          <div
            class="flex items-center gap-2 rounded-lg p-3 text-sm bg-accent/30"
          >
            <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              bind:this={draftInputEl}
              bind:value={draftName}
              class="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm caret-primary focus:outline-none focus:ring-1 focus:ring-primary"
              onkeydown={(e) => {
                if (e.key === 'Enter') commitDraft();
                if (e.key === 'Escape') cancelDraft();
              }}
              onblur={commitDraft}
              aria-label={$t('folders.new_subfolder')}
            />
          </div>
        </li>
      {/if}
      {#each subfolders as folder (folder.id)}
        <li>
          <div
            role="button"
            tabindex="0"
            class="group flex cursor-pointer items-center gap-2 rounded-lg p-3 text-sm transition-colors hover:bg-accent/50"
            onclick={() => onselect(folder.id)}
            onkeydown={(e) => e.key === 'Enter' && onselect(folder.id)}
          >
            <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
            {#if folder.decrypt_failed}
              <!-- Name is the only ciphertext - the folder itself stays browsable. -->
              <span
                class="min-w-0 flex-1 truncate italic text-muted-foreground"
                title={$t('folders.undecryptable_hint')}>{$t('folders.undecryptable')}</span
              >
            {:else}
              <span class="min-w-0 flex-1 truncate">{folder.name}</span>
            {/if}
            <ChevronRight
              class="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
            />
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}
