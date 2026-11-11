<script lang="ts">
	import { NavigationMenu as NavigationMenuPrimitive } from "bits-ui";
	import { cn } from "../../utils/cn.js";
	import NavigationMenuViewport from "./navigation-menu-viewport.svelte";
	import { textDirection } from "@reborn/i18n";

	// bits-ui puts the Root's `dir` (default "ltr") on the root element, which
	// would turn the menu left to right inside a right-to-left page.
	let {
		ref = $bindable(null),
		class: className,
		viewport = true,
		dir,
		children,
		...restProps
	}: NavigationMenuPrimitive.RootProps & {
		viewport?: boolean;
	} = $props();
</script>

<NavigationMenuPrimitive.Root
	bind:ref
	data-slot="navigation-menu"
	data-viewport={viewport}
	class={cn(
		"group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
		className
	)}
	dir={dir ?? $textDirection}
	{...restProps}
>
	{@render children?.()}

	{#if viewport}
		<NavigationMenuViewport />
	{/if}
</NavigationMenuPrimitive.Root>
