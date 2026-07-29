<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { XIcon } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import * as Dialog from "./index.js";
	import { cn, type WithoutChildrenOrChild } from "../../utils/cn";

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		showCloseButton = true,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: DialogPrimitive.PortalProps;
		children: Snippet;
		showCloseButton?: boolean;
	} = $props();
</script>

<Dialog.Portal {...portalProps}>
	<Dialog.Overlay />
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			// Geometry note: centered and capped inside --rn-safe-* (see
			// packages/ui/src/styles/global.css), NOT inside the raw viewport.
			// On the edge-to-edge native shells the viewport spans the system
			// bars, so a tall dialog measured against it puts its header (and
			// this component's close button) behind the status bar and its
			// footer behind the gesture bar - unclosable. On web every inset
			// is 0, so the result is the plain centered dialog.
			"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-[50%] top-[calc(var(--rn-vv-offset-top,0px)+var(--rn-safe-top,0px)+var(--rn-safe-height,100dvh)/2)] z-50 grid w-full max-w-[calc(100%-2rem-var(--rn-safe-x,0px))] max-h-[calc(var(--rn-safe-height,100dvh)-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		{#if showCloseButton}
			<DialogPrimitive.Close
				class="ring-offset-background focus:ring-ring rounded-xs focus:outline-hidden absolute right-4 top-4 opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
			>
				<XIcon />
				<span class="sr-only">Close</span>
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</Dialog.Portal>
