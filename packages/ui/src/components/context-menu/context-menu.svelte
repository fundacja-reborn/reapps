<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
	import { textDirection } from "@reborn/i18n";

	// bits-ui puts the Root's `dir` (default "ltr") on the menu element itself, so
	// `dir` on Content alone leaves an Arabic menu laid out left to right (#524).
	let { open = $bindable(false), dir, ...restProps }: ContextMenuPrimitive.RootProps = $props();
</script>

<ContextMenuPrimitive.Root bind:open dir={dir ?? $textDirection} {...restProps} />
