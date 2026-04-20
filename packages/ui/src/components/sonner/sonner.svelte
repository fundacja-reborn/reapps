<script lang="ts">
  import { Toaster as Sonner, type ToasterProps } from 'svelte-sonner';

  let { ...restProps }: ToasterProps = $props();
</script>

<Sonner
  theme="light"
  class="toaster group"
  toastOptions={{
    classes: {
      toast:
        'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
      description: 'group-[.toast]:text-muted-foreground',
      actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
      cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      error:
        'group toast group-[.toaster]:bg-destructive group-[.toaster]:text-destructive-foreground group-[.toaster]:border-destructive',
      success:
        'group toast group-[.toaster]:bg-green-50 group-[.toaster]:text-green-900 group-[.toaster]:border-green-200 dark:group-[.toaster]:bg-green-900 dark:group-[.toaster]:text-green-50 dark:group-[.toaster]:border-green-800',
      warning:
        'group toast group-[.toaster]:bg-yellow-50 group-[.toaster]:text-yellow-900 group-[.toaster]:border-yellow-200 dark:group-[.toaster]:bg-yellow-900 dark:group-[.toaster]:text-yellow-50 dark:group-[.toaster]:border-yellow-800',
      info: 'group toast group-[.toaster]:bg-blue-50 group-[.toaster]:text-blue-900 group-[.toaster]:border-blue-200 dark:group-[.toaster]:bg-blue-900 dark:group-[.toaster]:text-blue-50 dark:group-[.toaster]:border-blue-800'
    }
  }}
  {...restProps}
/>
