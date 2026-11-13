<script lang="ts">
  import { tick } from 'svelte';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button } from '@reborn/ui';
  import { Minus, Plus, Type } from '@lucide/svelte';
  import { intlLocale } from '@reborn/i18n';
  import { t, locale } from '$lib/stores/i18n.store';
  import {
    devicePrefs,
    stepTextScale,
    DEFAULT_TEXT_SCALE,
    NOTE_LINE_SPACING_STEPS,
    NOTE_TEXT_SCALE_STEPS,
    UI_SCALE_STEPS,
    type NoteLineSpacing,
    type NoteTextScale,
    type UiScale
  } from '$lib/stores/device-prefs.store';
  import MarkdownPreview from '$lib/components/MarkdownPreview.svelte';

  /**
   * Text size for this device (issue #511): interface scale + note text size,
   * and the line spacing of note content (issue #546), all as -/+ steppers. A
   * change applies at once to the whole app (the root layout writes it onto
   * <html>), so the page itself is the preview of the interface scale; the
   * sample below previews the note text and its line spacing.
   */

  const percentFormat = $derived(
    new Intl.NumberFormat(intlLocale($locale), { style: 'percent', maximumFractionDigits: 1 })
  );

  // One paragraph of two sentences: long enough to wrap on a wide screen too,
  // because the line spacing only shows between the lines of one paragraph.
  const sampleMarkdown = $derived(
    `## ${$t('settings_page.appearance.text_size_sample_heading')}\n\n${$t(
      'settings_page.appearance.text_size_sample_body'
    )} ${$t('settings_page.appearance.text_size_sample_wrap')}`
  );

  // The "Default" button disappears once used; hand focus to the group's "+"
  // so a keyboard / screen-reader user is not dropped onto <body>.
  async function focusIncrease(id: string) {
    await tick();
    document.getElementById(`${id}-increase`)?.focus();
  }

  function resetUi() {
    devicePrefs.setUiScale(DEFAULT_TEXT_SCALE);
    void focusIncrease('ui-scale');
  }

  function resetNote() {
    devicePrefs.setNoteTextScale(DEFAULT_TEXT_SCALE);
    void focusIncrease('note-scale');
  }

  function resetLineSpacing() {
    devicePrefs.setNoteLineSpacing(DEFAULT_TEXT_SCALE);
    void focusIncrease('note-line-spacing');
  }

  function stepUi(direction: 1 | -1) {
    devicePrefs.setUiScale(stepTextScale<UiScale>(UI_SCALE_STEPS, $devicePrefs.uiScale, direction));
  }

  function stepNote(direction: 1 | -1) {
    devicePrefs.setNoteTextScale(
      stepTextScale<NoteTextScale>(NOTE_TEXT_SCALE_STEPS, $devicePrefs.noteTextScale, direction)
    );
  }

  function stepLineSpacing(direction: 1 | -1) {
    devicePrefs.setNoteLineSpacing(
      stepTextScale<NoteLineSpacing>(
        NOTE_LINE_SPACING_STEPS,
        $devicePrefs.noteLineSpacing,
        direction
      )
    );
  }
</script>

{#snippet stepper(
  id: string,
  label: string,
  hint: string,
  value: number,
  steps: readonly number[],
  decreaseLabel: string,
  increaseLabel: string,
  onstep: (direction: 1 | -1) => void,
  onreset: () => void
)}
  {@const atMin = value <= steps[0]}
  {@const atMax = value >= steps[steps.length - 1]}
  <div role="group" aria-labelledby="{id}-label" aria-describedby="{id}-hint" class="space-y-2">
    <div>
      <p id="{id}-label" class="text-sm font-medium">{label}</p>
      <p id="{id}-hint" class="text-xs text-muted-foreground">{hint}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <!-- aria-disabled (not disabled) at the ends: a disabled button drops
           keyboard focus, which would strand a user stepping with Enter. -->
      <Button
        variant="outline"
        size="icon"
        aria-label={decreaseLabel}
        aria-disabled={atMin}
        onclick={() => {
          if (!atMin) onstep(-1);
        }}
      >
        <Minus />
      </Button>
      <output class="min-w-16 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {percentFormat.format(value / 100)}
      </output>
      <Button
        id="{id}-increase"
        variant="outline"
        size="icon"
        aria-label={increaseLabel}
        aria-disabled={atMax}
        onclick={() => {
          if (!atMax) onstep(1);
        }}
      >
        <Plus />
      </Button>
      {#if value !== DEFAULT_TEXT_SCALE}
        <Button variant="ghost" size="sm" onclick={onreset}>
          {$t('settings_page.appearance.text_size_default')}
        </Button>
      {/if}
    </div>
  </div>
{/snippet}

<Card>
  <CardHeader>
    <CardTitle class="text-base flex items-center gap-2">
      <Type class="h-4 w-4 text-muted-foreground" />
      {$t('settings_page.appearance.text_size')}
    </CardTitle>
    <CardDescription>{$t('settings_page.appearance.text_size_desc')}</CardDescription>
  </CardHeader>
  <CardContent class="space-y-5">
    {@render stepper(
      'ui-scale',
      $t('settings_page.appearance.ui_scale'),
      $t('settings_page.appearance.ui_scale_hint'),
      $devicePrefs.uiScale,
      UI_SCALE_STEPS,
      $t('settings_page.appearance.ui_scale_decrease'),
      $t('settings_page.appearance.ui_scale_increase'),
      stepUi,
      resetUi
    )}

    {@render stepper(
      'note-scale',
      $t('settings_page.appearance.note_scale'),
      $t('settings_page.appearance.note_scale_hint'),
      $devicePrefs.noteTextScale,
      NOTE_TEXT_SCALE_STEPS,
      $t('settings_page.appearance.note_scale_decrease'),
      $t('settings_page.appearance.note_scale_increase'),
      stepNote,
      resetNote
    )}

    {@render stepper(
      'note-line-spacing',
      $t('settings_page.appearance.line_spacing'),
      $t('settings_page.appearance.line_spacing_hint'),
      $devicePrefs.noteLineSpacing,
      NOTE_LINE_SPACING_STEPS,
      $t('settings_page.appearance.line_spacing_decrease'),
      $t('settings_page.appearance.line_spacing_increase'),
      stepLineSpacing,
      resetLineSpacing
    )}

    <!-- Note text sample: the real preview renderer, so it matches notes 1:1
         (mobile vs desktop base size, heading scale, --rn-note-scale,
         --rn-note-leading). -->
    <figure class="space-y-1.5">
      <figcaption class="text-xs text-muted-foreground">
        {$t('settings_page.appearance.text_size_preview')}
      </figcaption>
      <div class="overflow-hidden rounded-md border">
        <MarkdownPreview content={sampleMarkdown} class="px-4" />
      </div>
    </figure>
  </CardContent>
</Card>
