<!-- Deprecated: Use svelte-sonner instead -->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  export interface ToastActionProps extends HTMLButtonAttributes {}

  let props: ToastActionProps = $props();
</script>

<!-- Empty component for backward compatibility -->
