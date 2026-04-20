<script lang="ts">
	import { Drawer as DrawerPrimitive } from 'vaul-svelte';
	import DrawerContent from '../drawer/drawer-content.svelte';
	import DrawerHeader from '../drawer/drawer-header.svelte';
	import DrawerTitle from '../drawer/drawer-title.svelte';
	import DrawerFooter from '../drawer/drawer-footer.svelte';
	import Root from '../button/button.svelte';
	import WheelColumn from './WheelColumn.svelte';

	let {
		open = $bindable(false),
		hour = 0,
		minute = 0,
		title = 'Set time',
		cancelLabel = 'Cancel',
		confirmLabel = 'Save',
		onConfirm,
		onCancel
	} = $props<{
		open?: boolean;
		hour?: number;
		minute?: number;
		title?: string;
		cancelLabel?: string;
		confirmLabel?: string;
		onConfirm?: (hour: number, minute: number) => void;
		onCancel?: () => void;
	}>();

	const hours = Array.from({ length: 24 }, (_, i) => i);
	const minutes = Array.from({ length: 60 }, (_, i) => i);

	let tempHour = $state(0);
	let tempMinute = $state(0);

	// Sync temp values when drawer opens
	$effect(() => {
		if (open) {
			tempHour = hour;
			tempMinute = minute;
		}
	});

	function handleConfirm() {
		onConfirm?.(tempHour, tempMinute);
		open = false;
	}

	function handleCancel() {
		onCancel?.();
		open = false;
	}

	function handleOpenChange(newOpen: boolean) {
		if (!newOpen && open) {
			// Closing without confirm = cancel
			onCancel?.();
		}
		open = newOpen;
	}
</script>

<DrawerPrimitive.Root bind:open onOpenChange={handleOpenChange} shouldScaleBackground={false}>
	<DrawerContent class="mx-auto max-w-sm">
		<DrawerHeader class="text-center">
			<DrawerTitle class="text-base">{title}</DrawerTitle>
		</DrawerHeader>

		<div class="flex items-center justify-center gap-0 px-6 py-2">
			<WheelColumn
				items={hours}
				bind:value={tempHour}
				label="H"
			/>

			<span class="text-3xl font-bold text-foreground px-3 mt-5 select-none">:</span>

			<WheelColumn
				items={minutes}
				bind:value={tempMinute}
				label="M"
			/>
		</div>

		<DrawerFooter class="flex-row gap-3 px-6 pb-8">
			<Root variant="outline" class="flex-1" onclick={handleCancel}>
				{cancelLabel}
			</Root>
			<Root class="flex-1" onclick={handleConfirm}>
				{confirmLabel}
			</Root>
		</DrawerFooter>
	</DrawerContent>
</DrawerPrimitive.Root>
