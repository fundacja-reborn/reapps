<script lang="ts">
  import { Check, X } from '@lucide/svelte';
  import { textDirection } from '@reborn/i18n';
  import { t } from '$lib/stores/i18n.store';
  import { APPEARANCE_COLORS, APPEARANCE_SWATCH_CLASS } from '$lib/utils/appearance-colors';
  import { radioGridTarget } from '$lib/utils/radio-grid-nav';

  /**
   * The palette as a radio group of swatches: "no color" + the eight
   * appearance colors. Shared by the folder appearance dialog and the note
   * color dialog.
   *
   * Roving tabindex (WAI-ARIA radio group): only the checked swatch is in the
   * tab order and arrows move AND select; the row wraps, so Up/Down step like
   * Left/Right, and Left/Right follow the visual direction in RTL. With
   * nothing checked (`mixed`: several notes with different colors, or a key
   * this build does not know) the first swatch keeps the tab stop.
   *
   * Selection shows as a check mark and a ring - not by color alone - and
   * every swatch carries its translated color name.
   */
  let {
    value,
    mixed = false,
    labelledby,
    noneLabel,
    touch = false,
    onchoose
  }: {
    /** Chosen key; `undefined` = no color. */
    value: string | undefined;
    /** Nothing is checked (the current values differ). */
    mixed?: boolean;
    /** Id of the visible heading that names the group. */
    labelledby: string;
    /** Label of the "no color" option. */
    noneLabel: string;
    /** 44 px swatches for touch screens. */
    touch?: boolean;
    onchoose: (value: string | undefined) => void;
  } = $props();

  // `undefined` = no color.
  const options: (string | undefined)[] = [undefined, ...APPEARANCE_COLORS];

  const checkedIndex = $derived(mixed ? -1 : options.indexOf(value));
  const tabStopIndex = $derived(Math.max(0, checkedIndex));

  let groupEl = $state<HTMLElement | null>(null);

  function label(option: string | undefined): string {
    return option ? $t(`colors.${option}`) : noneLabel;
  }

  function handleKeydown(e: KeyboardEvent) {
    const next = radioGridTarget(e.key, tabStopIndex, options.length, {
      columns: 1,
      rtl: $textDirection === 'rtl'
    });
    if (next === null) return;
    e.preventDefault();
    onchoose(options[next]);
    groupEl?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }

  const swatchSize = $derived(touch ? 'h-11 w-11' : 'h-8 w-8');
</script>

<div
  bind:this={groupEl}
  role="radiogroup"
  aria-labelledby={labelledby}
  tabindex="-1"
  class="flex flex-wrap gap-2"
  onkeydown={handleKeydown}
>
  {#each options as option, i (option ?? 'none')}
    {@const checked = i === checkedIndex}
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label(option)}
      title={label(option)}
      tabindex={i === tabStopIndex ? 0 : -1}
      class="flex {swatchSize} shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
        {option
        ? APPEARANCE_SWATCH_CLASS[option as keyof typeof APPEARANCE_SWATCH_CLASS]
        : 'border border-dashed border-muted-foreground/60'}
        {checked ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}"
      onclick={() => onchoose(option)}
    >
      {#if option && checked}
        <Check class="h-4 w-4 text-white dark:text-gray-900" />
      {:else if !option}
        <X class="h-3.5 w-3.5 text-muted-foreground" />
      {/if}
    </button>
  {/each}
</div>
