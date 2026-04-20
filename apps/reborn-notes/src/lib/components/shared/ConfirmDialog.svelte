<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button
  } from '@reborn/ui';

  let {
    open = $bindable(false),
    title,
    description,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive = false,
    onConfirm,
    onCancel
  }: {
    open: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void;
  } = $props();

  let isProcessing = $state(false);

  async function handleConfirm() {
    if (!onConfirm) { open = false; return; }
    isProcessing = true;
    try {
      await onConfirm();
      open = false;
    } finally {
      isProcessing = false;
    }
  }

  function handleCancel() {
    onCancel?.();
    open = false;
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      {#if description}
        <DialogDescription>{description}</DialogDescription>
      {/if}
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onclick={handleCancel} disabled={isProcessing}>
        {cancelText}
      </Button>
      <Button
        variant={destructive ? 'destructive' : 'default'}
        onclick={handleConfirm}
        disabled={isProcessing}
      >
        {confirmText}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
