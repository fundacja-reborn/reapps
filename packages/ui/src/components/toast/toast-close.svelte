<!-- Deprecated: Use svelte-sonner instead -->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  export interface ToastCloseProps extends HTMLButtonAttributes {}

  let props: ToastCloseProps = $props();
</script>

<!-- Empty component for backward compatibility -->
