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
	import { AlertCircle, Info, CheckCircle, XCircle } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';

	let {
		open = $bindable(false),
		title,
		description,
		confirmText = $t('common.confirm'),
		cancelText = $t('common.cancel'),
		variant = 'default',
		onConfirm,
		onCancel
	} = $props<{
		open: boolean;
		title: string;
		description?: string;
		confirmText?: string;
		cancelText?: string;
		variant?: 'default' | 'destructive' | 'success' | 'warning';
		onConfirm?: () => void | Promise<void>;
		onCancel?: () => void;
	}>();

	let isProcessing = $state(false);

	// Icon based on variant
	let Icon = $derived(
		variant === 'destructive'
			? XCircle
			: variant === 'success'
				? CheckCircle
				: variant === 'warning'
					? AlertCircle
					: Info
	);

	// Icon color class based on variant
	let iconClass = $derived(
		`h-5 w-5 ${
			variant === 'destructive'
				? 'text-destructive'
				: variant === 'success'
					? 'text-green-600'
					: variant === 'warning'
						? 'text-yellow-600'
						: ''
		}`
	);

	// Button variant
	let buttonVariant = $derived(
		(variant === 'destructive' ? 'destructive' : 'default') as 'destructive' | 'default'
	);

	async function handleConfirm() {
		if (!onConfirm) {
			open = false;
			return;
		}

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
			<DialogTitle class="flex items-center gap-2">
				<Icon class={iconClass} />
				{title}
			</DialogTitle>
			{#if description}
				<DialogDescription>
					{description}
				</DialogDescription>
			{/if}
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={handleCancel} disabled={isProcessing}>
				{cancelText}
			</Button>
			<Button variant={buttonVariant} onclick={handleConfirm} disabled={isProcessing}>
				{confirmText}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
