<script lang="ts">
  import { Pencil, PencilLine, Check } from '@lucide/svelte';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button
  } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { editorMode } from '$lib/stores/app-settings.store';
  import type { EditorMode } from '@reborn/storage';

  let {
    open = $bindable(false),
    onclose
  }: {
    open: boolean;
    onclose: (chosenMode: EditorMode | null) => void;
  } = $props();

  let chosen = $state<EditorMode>($editorMode);
  let completed = false;

  $effect(() => {
    if (open) {
      chosen = $editorMode;
      completed = false;
    }
  });

  function handleContinue() {
    completed = true;
    open = false;
    onclose(chosen);
  }

  function handleOpenChange(v: boolean) {
    open = v;
    if (!v && !completed) onclose(null);
  }
</script>

<Dialog {open} onOpenChange={handleOpenChange}>
  <DialogContent class="sm:max-w-[480px]">
    <DialogHeader>
      <DialogTitle>{$t('editor_mode_intro.title')}</DialogTitle>
      <DialogDescription>{$t('editor_mode_intro.description')}</DialogDescription>
    </DialogHeader>

    <div class="grid gap-3 py-2">
      <button
        type="button"
        class="group flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors {chosen ===
        'live'
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/40 hover:bg-accent/30'}"
        onclick={() => (chosen = 'live')}
        aria-pressed={chosen === 'live'}
      >
        <div
          class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md {chosen ===
          'live'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'}"
        >
          <PencilLine class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium">{$t('editor_mode_intro.option_live_label')}</span>
            <span
              class="inline-flex items-center rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
            >
              {$t('editor_mode_intro.recommended')}
            </span>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            {$t('editor_mode_intro.option_live_description')}
          </p>
        </div>
        {#if chosen === 'live'}
          <Check class="mt-1 h-5 w-5 shrink-0 text-primary" />
        {/if}
      </button>

      <button
        type="button"
        class="group flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors {chosen ===
        'markdown'
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/40 hover:bg-accent/30'}"
        onclick={() => (chosen = 'markdown')}
        aria-pressed={chosen === 'markdown'}
      >
        <div
          class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md {chosen ===
          'markdown'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'}"
        >
          <Pencil class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-medium">{$t('editor_mode_intro.option_markdown_label')}</div>
          <p class="mt-1 text-sm text-muted-foreground">
            {$t('editor_mode_intro.option_markdown_description')}
          </p>
        </div>
        {#if chosen === 'markdown'}
          <Check class="mt-1 h-5 w-5 shrink-0 text-primary" />
        {/if}
      </button>
    </div>

    <p class="text-xs text-muted-foreground">
      {$t('editor_mode_intro.hint_switch_later')}
    </p>

    <DialogFooter>
      <Button onclick={handleContinue}>
        {$t('editor_mode_intro.continue_button')}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
