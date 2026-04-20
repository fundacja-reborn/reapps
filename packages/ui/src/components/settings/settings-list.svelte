<script lang="ts">
	import { cn } from "../../utils/cn";

	let { class: className, children } = $props<{
		class?: string;
		children: any;
	}>();
</script>

<div class={cn('divide-y divide-border', className)}>
	{@render children()}
</div>

