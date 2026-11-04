<script lang="ts">
	import { PinInput as InputOTPPrimitive } from "bits-ui";
	import { cn } from "../../utils/cn.js";

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(""),
		...restProps
	}: InputOTPPrimitive.RootProps = $props();
</script>

<!-- One-time codes are digit sequences read left-to-right in every locale,
     so the slots never mirror in an RTL UI (overridable via restProps). -->
<InputOTPPrimitive.Root
	bind:ref
	bind:value
	dir="ltr"
	data-slot="input-otp"
	class={cn(
		"has-disabled:opacity-50 flex items-center gap-2 [&_input]:disabled:cursor-not-allowed",
		className
	)}
	{...restProps}
/>
