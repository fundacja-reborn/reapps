<script lang="ts">
  import { Check, Minus } from '@lucide/svelte';
  import { cn } from '../../utils/cn';
  import { Checkbox as CheckboxPrimitive } from 'bits-ui';
  import type { CheckboxProps } from './types.js';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    disabled = false,
    class: className,
    ...restProps
  }: CheckboxProps = $props();
</script>

<CheckboxPrimitive.Root
  bind:ref
  bind:checked
  {disabled}
  class={cn(
    "peer relative size-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground before:absolute before:-inset-[10px] before:content-['']",
    className
  )}
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    <div class={cn('flex items-center justify-center text-current')}>
      {#if indeterminate}
        <Minus class="size-3.5" />
      {:else if checked}
        <Check class="size-3.5" />
      {/if}
    </div>
  {/snippet}
</CheckboxPrimitive.Root>
