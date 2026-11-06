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
  import { weekdayName } from '@reborn/i18n';
  import { currentLanguage, weekStartsOn } from '$lib/stores/app-settings.store';
  import { getAnchorDate, weekRangeTitle } from '$lib/services/periodic-notes-format';

  let {
    kind,
    onclose
  }: {
    /** Which kind triggered the modal. `null` keeps the dialog closed. */
    kind: PeriodicKind | null;
    onclose: () => void;
  } = $props();

  const open = $derived(kind !== null);

  // The weekly copy names the user's week (#493): its first and last day, and
  // for a week not starting on Monday the date-range title it gets.
  const weekValues = $derived({
    first: weekdayName($weekStartsOn, $currentLanguage),
    last: weekdayName($weekStartsOn + 6, $currentLanguage),
    example: weekRangeTitle(getAnchorDate('weekly', new Date(), $weekStartsOn))
  });
  const tipKey = $derived(
    kind === 'weekly' && $weekStartsOn !== 1
      ? 'notes.periodic.weekly.onboarding.tip_range'
      : `notes.periodic.${kind}.onboarding.tip`
  );

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
              {$t(`notes.periodic.${kind}.onboarding.body`, { values: weekValues })}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div class="rounded-md border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        {$t(tipKey, { values: weekValues })}
      </div>

      <DialogFooter class="gap-2 sm:gap-2">
        <Button variant="outline" onclick={handleOpenSettings}>
          <Settings class="me-2 h-4 w-4" />
          {$t('notes.periodic.onboarding.open_settings')}
        </Button>
        <Button onclick={onclose}>
          {$t('notes.periodic.onboarding.got_it')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
{/if}
