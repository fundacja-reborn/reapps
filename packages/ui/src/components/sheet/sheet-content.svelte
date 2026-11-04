<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";
	export const sheetVariants = tv({
		base: "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 gap-4 p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
		variants: {
			// `left` / `right` are logical despite the names (kept for shadcn
			// compatibility): `left` is the inline-start side and `right` the
			// inline-end side, so in RTL the panels mirror - a `right` sheet
			// (outline, version history) opens from the left edge.
			side: {
				top: "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 border-b",
				bottom: "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 border-t",
				// Physical slide + `rtl:` override rather than tw-animate's
				// `slide-in-from-start`: its `:dir()` selector is rewritten to a
				// `:lang()` list in the production CSS, which misses the
				// `?dir=rtl` smoke-test mode (`lang="en"`, `dir="rtl"`).
				left: "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left rtl:data-[state=closed]:slide-out-to-right rtl:data-[state=open]:slide-in-from-right inset-y-0 inset-s-0 h-full w-3/4 border-e sm:max-w-sm",
				right: "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right rtl:data-[state=closed]:slide-out-to-left rtl:data-[state=open]:slide-in-from-left inset-y-0 inset-e-0 h-full w-3/4 border-s sm:max-w-sm",
			},
		},
		defaultVariants: {
			side: "right",
		},
	});

	export type Side = VariantProps<typeof sheetVariants>["side"];
</script>

<script lang="ts">
	import { Dialog as SheetPrimitive, type WithoutChildrenOrChild } from "bits-ui";
	import { X } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import SheetOverlay from "./sheet-overlay.svelte";
	import { cn } from "../../utils/cn.js";

	let {
		ref = $bindable(null),
		class: className,
		side = "right",
		portalProps,
		overlayClass,
		children,
		...restProps
	}: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
		portalProps?: SheetPrimitive.PortalProps;
		side?: Side;
		/**
		 * Extra classes for the backdrop overlay (merged over the default
		 * `bg-black/80`). Use a lighter scrim (e.g. `bg-black/20`) for
		 * non-destructive navigation panels where the user wants to see the
		 * content react underneath; leave unset for modal/confirm dialogs.
		 */
		overlayClass?: string;
		children: Snippet;
	} = $props();
</script>

<SheetPrimitive.Portal {...portalProps}>
	<SheetOverlay class={overlayClass} />
	<SheetPrimitive.Content bind:ref class={cn(sheetVariants({ side }), className)} {...restProps}>
		{@render children?.()}
		<SheetPrimitive.Close
			class="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute inset-e-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none"
		>
			<X class="size-4" />
			<span class="sr-only">Close</span>
		</SheetPrimitive.Close>
	</SheetPrimitive.Content>
</SheetPrimitive.Portal>
