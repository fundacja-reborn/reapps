<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
	import { textDirection } from "@reborn/i18n";
	import { cn } from '../../utils/cn';

	let {
		ref = $bindable(null),
		portalProps,
		class: className,
		dir,
		...restProps
	}: ContextMenuPrimitive.ContentProps & {
		portalProps?: ContextMenuPrimitive.PortalProps;
	} = $props();
</script>

<ContextMenuPrimitive.Portal {...portalProps}>
	<ContextMenuPrimitive.Content
		bind:ref
		class={cn(
			"bg-popover text-popover-foreground z-50 min-w-[8rem] rounded-md border p-1 shadow-md focus:outline-none",
			className
		)}
		dir={dir ?? $textDirection}
		{...restProps}
	/>
</ContextMenuPrimitive.Portal>
