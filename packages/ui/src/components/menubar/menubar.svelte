<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { cn } from "../../utils/cn";
	import { textDirection } from "@reborn/i18n";

	// bits-ui gives each menu the Root's `dir` (default "ltr"), see dropdown-menu.svelte.
	let {
		ref = $bindable(null),
		class: className,
		dir,
		...restProps
	}: MenubarPrimitive.RootProps = $props();
</script>

<MenubarPrimitive.Root
	bind:ref
	class={cn("bg-background flex h-10 items-center gap-1 rounded-md border p-1", className)}
	dir={dir ?? $textDirection}
	{...restProps}
/>
