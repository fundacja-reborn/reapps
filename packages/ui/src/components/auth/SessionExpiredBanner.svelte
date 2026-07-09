<!--
  @component
  Non-dismissible banner shown when the user's session has expired.
  Displays at the top of the page and opens a re-auth modal on click.
  Does NOT trigger logout — preserves master key in RAM (offline-first).

  The modal handles the full re-auth flow, including the 2FA second step
  when the account has two-factor authentication enabled.
-->
<script lang="ts">
  import { AlertTriangle } from '@lucide/svelte';
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { t } from '@reborn/i18n';
  import ReAuthModal from './ReAuthModal.svelte';
  import type { ReAuthResult } from './reauth-types';

  let {
    username = '',
    visible = false,
    onReAuth,
    onVerifyTotp
  } = $props<{
    username?: string;
    visible?: boolean;
    /** Submit password — may return `two_factor_required` to trigger TOTP step. */
    onReAuth?: (password: string) => Promise<ReAuthResult>;
    /** Submit the challenge token + TOTP / recovery code after `two_factor_required`. */
    onVerifyTotp?: (challengeToken: string, code: string) => Promise<ReAuthResult>;
  }>();

  let modalOpen = $state(false);

  function handleBannerClick() {
    modalOpen = true;
  }
</script>

{#if visible}
  <!-- slide: in reborn-notes this banner sits in the measured stack feeding
       --rn-banner-h (100dvh layouts subtract it), so an instant mount/unmount
       snaps the whole UI by the banner height. Animating the height lets the
       ResizeObserver-based measurement follow smoothly. -->
  <div
    transition:slide={{ duration: prefersReducedMotion.current ? 0 : 200 }}
    class="sticky top-0 z-50"
  >
    <!-- pt: max() extends the banner's red background under the iOS notch /
         Dynamic Island so the text starts below it (env() is 0 elsewhere) -->
    <button
      type="button"
      onclick={handleBannerClick}
      class="flex w-full items-center justify-center gap-2 bg-destructive px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top,0px))] text-sm font-medium text-white transition-colors hover:bg-destructive/90"
    >
      <AlertTriangle class="h-4 w-4 shrink-0" />
      <span>{$t('auth.session.expired_banner')}</span>
    </button>
  </div>
{/if}

<ReAuthModal
  bind:open={modalOpen}
  {username}
  onSubmitPassword={onReAuth}
  onSubmitTotp={onVerifyTotp}
/>
