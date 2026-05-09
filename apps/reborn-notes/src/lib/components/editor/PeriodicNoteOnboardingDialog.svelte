<script lang="ts">
  import { CalendarDays, CalendarRange, CalendarClock, Settings } from '@lucide/svelte';
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
  import { goto } from '$lib/utils/navigation';
  import type { PeriodicKind } from '@reborn/storage';

  let {
    kind,
    onclose
  }: {
    /** Which kind triggered the modal. `null` keeps the dialog closed. */
    kind: PeriodicKind | null;
    onclose: () => void;
  } = $props();

  const open = $derived(kind !== null);

  const ICONS = {
    daily: CalendarDays,
    weekly: CalendarRange,
    monthly: CalendarClock
  } as const;

  function handleOpenChange(v: boolean) {
    if (!v) onclose();
  }

  async function handleOpenSettings() {
    onclose();
    await goto('/settings/periodic-notes');
  }
</script>

{#if kind}
  {@const Icon = ICONS[kind]}
  <Dialog {open} onOpenChange={handleOpenChange}>
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader>
        <div class="flex items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Icon class="h-5 w-5" />
          </div>
          <div class="min-w-0 flex-1">
            <DialogTitle>{$t(`notes.periodic.${kind}.onboarding.title`)}</DialogTitle>
            <DialogDescription class="mt-1.5 text-sm leading-relaxed">
              {$t(`notes.periodic.${kind}.onboarding.body`)}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div class="rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        {$t(`notes.periodic.${kind}.onboarding.tip`)}
      </div>

      <DialogFooter class="gap-2 sm:gap-2">
        <Button variant="outline" onclick={handleOpenSettings}>
          <Settings class="mr-2 h-4 w-4" />
          {$t('notes.periodic.onboarding.open_settings')}
        </Button>
        <Button onclick={onclose}>
          {$t('notes.periodic.onboarding.got_it')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
{/if}
