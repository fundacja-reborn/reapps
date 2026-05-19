<!--
  @component
  Singleton re-auth modal driven by `requireSessionPromptStore`. Mounted once
  per app in `+layout.svelte` and triggered imperatively by `requireActiveSession()`.

  Same flow as SessionExpiredBanner's modal (password → optional TOTP), but
  the description text is customisable per call site so the user understands
  which action triggered the prompt.
-->
<script lang="ts">
  import ReAuthModal from './ReAuthModal.svelte';
  import { requireSessionPromptStore } from './require-session';
  import type { ReAuthResult } from './reauth-types';

  let {
    username = '',
    onReAuth,
    onVerifyTotp
  } = $props<{
    username?: string;
    onReAuth?: (password: string) => Promise<ReAuthResult>;
    onVerifyTotp?: (userId: string, code: string) => Promise<ReAuthResult>;
  }>();

  let open = $state(false);
  let description = $state<string | undefined>(undefined);
  let pendingResolve: ((ok: boolean) => void) | null = null;

  // Subscribe to the imperative store. When state.open flips to true a new
  // requireActiveSession() call is awaiting; capture its resolver and open the
  // dialog. When it flips back to false (either because we resolved it or some
  // other caller reset the store), make sure we don't double-resolve.
  $effect(() => {
    const unsubscribe = requireSessionPromptStore.subscribe((state) => {
      if (state.open) {
        pendingResolve = state.resolve;
        description = state.description;
        open = true;
      } else {
        pendingResolve = null;
        open = false;
      }
    });
    return unsubscribe;
  });

  function handleClose(success: boolean) {
    const resolver = pendingResolve;
    pendingResolve = null;
    if (resolver) resolver(success);
  }
</script>

<ReAuthModal
  bind:open
  {username}
  {description}
  onSubmitPassword={onReAuth}
  onSubmitTotp={onVerifyTotp}
  onClose={handleClose}
/>
