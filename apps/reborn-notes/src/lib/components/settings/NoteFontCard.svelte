<script lang="ts">
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger
  } from '@reborn/ui';
  import { CaseSensitive } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { devicePrefs } from '$lib/stores/device-prefs.store';
  import {
    DEFAULT_NOTE_FONT,
    NOTE_ARABIC_FONTS,
    NOTE_FONTS,
    NOTE_FONT_FAMILIES,
    isNoteArabicFont,
    isNoteFont
  } from '$lib/utils/note-font';
  import MarkdownPreview from '$lib/components/MarkdownPreview.svelte';

  /**
   * Note font for this device (issue #546): one choice for Latin script and one
   * for Arabic script, both always shown. The interface language says nothing
   * about the language of the notes (an English interface over Arabic notes,
   * or notes that mix both), and the two fonts work together - the browser
   * picks per character. A change applies at once (the root layout writes it
   * onto <html> and fetches the font files); the sample below is the real
   * preview renderer, so it shows the result as notes will.
   *
   * Font names are proper names and stay in Latin script in every language.
   */

  const latinOptions = $derived(
    NOTE_FONTS.map((value) => ({
      value,
      label:
        value === DEFAULT_NOTE_FONT
          ? $t('settings_page.appearance.note_font_default_latin')
          : NOTE_FONT_FAMILIES[value].family
    }))
  );

  const arabicOptions = $derived(
    NOTE_ARABIC_FONTS.map((value) => ({
      value,
      label:
        value === DEFAULT_NOTE_FONT
          ? $t('settings_page.appearance.note_font_default_arabic')
          : NOTE_FONT_FAMILIES[value].family
    }))
  );

  // One paragraph per script; the preview gives each its own direction.
  const sampleMarkdown = $derived(
    `${$t('settings_page.appearance.note_font_sample_latin')}\n\n${$t(
      'settings_page.appearance.note_font_sample_arabic'
    )}`
  );

  function setLatin(value: string | undefined) {
    if (isNoteFont(value)) devicePrefs.setNoteFont(value);
  }

  function setArabic(value: string | undefined) {
    if (isNoteArabicFont(value)) devicePrefs.setNoteArabicFont(value);
  }
</script>

{#snippet picker(
  id: string,
  label: string,
  value: string,
  options: readonly { value: string; label: string }[],
  onchange: (value: string | undefined) => void
)}
  <div class="space-y-2">
    <p id="{id}-label" class="text-sm font-medium">{label}</p>
    <Select type="single" {value} onValueChange={onchange}>
      <SelectTrigger class="w-full" aria-labelledby="{id}-label {id}-value">
        <!-- Font names are Latin-script proper names: isolate them so an RTL
             interface keeps "Source Serif 4" in reading order. -->
        <bdi id="{id}-value">{options.find((option) => option.value === value)?.label}</bdi>
      </SelectTrigger>
      <SelectContent>
        {#each options as option (option.value)}
          <SelectItem value={option.value}><bdi>{option.label}</bdi></SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>
{/snippet}

<Card>
  <CardHeader>
    <CardTitle class="text-base flex items-center gap-2">
      <CaseSensitive class="h-4 w-4 text-muted-foreground" />
      {$t('settings_page.appearance.note_font')}
    </CardTitle>
    <CardDescription>{$t('settings_page.appearance.note_font_desc')}</CardDescription>
  </CardHeader>
  <CardContent class="space-y-5">
    {@render picker(
      'note-font-latin',
      $t('settings_page.appearance.note_font_latin'),
      $devicePrefs.noteFont,
      latinOptions,
      setLatin
    )}

    {@render picker(
      'note-font-arabic',
      $t('settings_page.appearance.note_font_arabic'),
      $devicePrefs.noteArabicFont,
      arabicOptions,
      setArabic
    )}

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
