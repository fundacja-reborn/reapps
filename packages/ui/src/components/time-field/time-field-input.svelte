<script lang="ts">
	import { TimeField as TimeFieldPrimitive, type WithoutChildrenOrChild } from "bits-ui";
	import { cn } from "../../utils/cn";

	type Props = WithoutChildrenOrChild<TimeFieldPrimitive.RootProps> & {
		class?: string;
		inputClass?: string;
		name?: string;
	};

	let {
		value = $bindable(),
		placeholder = $bindable(),
		class: className,
		inputClass,
		name,
		...restProps
	}: Props = $props();
</script>

<TimeFieldPrimitive.Root
	bind:value={value as never}
	bind:placeholder
	{...restProps}
>
	<TimeFieldPrimitive.Input
		{name}
		class={cn(
			"flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
			"focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
			"data-[invalid]:border-destructive",
			"data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
			inputClass
		)}
	>
		{#snippet children({ segments })}
			{#each segments as { part, value: segValue }}
				{#if part === "literal"}
					<TimeFieldPrimitive.Segment
						{part}
						class="text-muted-foreground px-0.5"
					>
						{segValue}
					</TimeFieldPrimitive.Segment>
				{:else}
					<TimeFieldPrimitive.Segment
						{part}
						class={cn(
							"rounded px-1 py-0.5 tabular-nums",
							"hover:bg-muted",
							"focus:bg-primary focus:text-primary-foreground focus:outline-none",
							"aria-[valuetext=Empty]:text-muted-foreground",
							"data-[invalid]:text-destructive",
							"data-[disabled]:opacity-50",
							"data-[readonly]:opacity-70"
						)}
					>
						{segValue}
					</TimeFieldPrimitive.Segment>
				{/if}
			{/each}
		{/snippet}
	</TimeFieldPrimitive.Input>
</TimeFieldPrimitive.Root>
