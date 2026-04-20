<script lang="ts">
	import { cn } from "../../utils/cn";

	let { title, class: className, children } = $props<{
		title: string;
		class?: string;
		children: any;
	}>();
</script>

<div class={cn('space-y-1', className)}>
	<h3 class="px-4 text-sm font-medium text-muted-foreground">{title}</h3>
	<div class="bg-card rounded-lg border">
		{@render children()}
	</div>
</div>

