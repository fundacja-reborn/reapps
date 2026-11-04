<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { textDirection } from "@reborn/i18n";
	import { cn } from "../../utils/cn";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 8,
		alignOffset = -4,
		align = "start",
		side = "bottom",
		portalProps,
		dir,
		...restProps
	}: MenubarPrimitive.ContentProps & {
		portalProps?: MenubarPrimitive.PortalProps;
	} = $props();
</script>

<MenubarPrimitive.Portal {...portalProps}>
	<MenubarPrimitive.Content
		bind:ref
		{sideOffset}
		{align}
		{alignOffset}
		{side}
		class={cn(
			"bg-popover text-popover-foreground z-50 min-w-[12rem] rounded-md border p-1 shadow-md focus:outline-none",
			className
		)}
		dir={dir ?? $textDirection}
		{...restProps}
	/>
</MenubarPrimitive.Portal>
