<!-- UnlockPage.svelte -->
<script lang="ts">
  import AuthLayout from './AuthLayout.svelte';
  import UnlockE2E from './UnlockE2E.svelte';
  import type { Snippet } from 'svelte';
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
    error = null,
    attemptsRemaining,
    onUnlock,
    onLogout,
    header,
    footer
  } = $props<{
    username?: string;
    loading?: boolean;
    error?: string | null;
    attemptsRemaining?: number;
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
    {error}
    {attemptsRemaining}
    {onUnlock}
    onLogout={handleLogoutRequest}
  />
</AuthLayout>

<Dialog bind:open={logoutDialogOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Sign out</DialogTitle>
      <DialogDescription>
        Are you sure you want to log out? You will need to enter your username and password to log
        back in.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button
        variant="outline"
        onclick={() => {
          logoutDialogOpen = false;
        }}>Cancel</Button
      >
      <Button variant="destructive" onclick={confirmLogout}>Sign out</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
