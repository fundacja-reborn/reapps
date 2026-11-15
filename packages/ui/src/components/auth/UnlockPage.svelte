<!-- UnlockPage.svelte -->
<script lang="ts">
  import AuthLayout from './AuthLayout.svelte';
  import UnlockE2E from './UnlockE2E.svelte';
  import type { Snippet } from 'svelte';
  import { t } from '@reborn/i18n';
  import type { UnlockFailure } from './unlock-types';
  import { Button } from '../button';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '../dialog';

  let {
    username = '',
    loading = false,
    failure = null,
    retryAt = 0,
    onUnlock,
    onLogout,
    header,
    footer
  } = $props<{
    username?: string;
    loading?: boolean;
    /** Why the last attempt failed, or null. */
    failure?: UnlockFailure | null;
    /** Epoch ms before which another attempt is refused (0 = no delay running). */
    retryAt?: number;
    onUnlock?: (password: string) => void;
    onLogout?: () => void;
    header?: Snippet;
    footer?: Snippet;
  }>();

  let logoutDialogOpen = $state(false);

  function handleLogoutRequest() {
    logoutDialogOpen = true;
  }

  function confirmLogout() {
    logoutDialogOpen = false;
    onLogout?.();
  }
</script>

<AuthLayout {header} {footer}>
  <UnlockE2E
    {username}
    {loading}
    {failure}
    {retryAt}
    {onUnlock}
    onLogout={handleLogoutRequest}
  />
</AuthLayout>

<Dialog bind:open={logoutDialogOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$t('auth.unlock.logout_title')}</DialogTitle>
      <DialogDescription>
        {$t('auth.unlock.logout_desc')}
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button
        variant="outline"
        onclick={() => {
          logoutDialogOpen = false;
        }}>{$t('common.cancel')}</Button
      >
      <Button variant="destructive" onclick={confirmLogout}
        >{$t('auth.unlock.logout_confirm')}</Button
      >
    </DialogFooter>
  </DialogContent>
</Dialog>
