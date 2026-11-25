<!--
	@component
	Generic application header component with slots for dynamic content.
	Provides a consistent structure with sidebar trigger and action areas.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SidebarTrigger, Button } from '@reborn/ui';
	import { cn } from '@reborn/ui/utils';
	import { ArrowLeft } from '@lucide/svelte';

	interface Props {
		class?: string;
		children?: Snippet;
		actions?: Snippet;
		showBackButton?: boolean;
		onBack?: () => void;
	}

	let {
		class: className = '',
		children,
		actions,
		showBackButton = false,
		onBack
	}: Props = $props();
</script>

<!-- Top of the screen: in the edge-to-edge native shells the header starts
     under the status bar, so it pads by the top safe-area inset and its height
     grows by the same amount (0 on the web). Guideline 61, "Safe-area". -->
<header
	class={cn(
		'flex min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] md:min-h-[calc(3rem+env(safe-area-inset-top,0px))] shrink-0 items-center border-b bg-background pt-[env(safe-area-inset-top,0px)]',
		showBackButton ? 'gap-1 px-3' : 'gap-4 px-6',
		className
	)}
>
	{#if showBackButton && onBack}
		<div class="flex-shrink-0">
			<Button variant="ghost" size="icon" class="h-11 w-11" onclick={onBack}>
				<ArrowLeft class="h-5 w-5" />
			</Button>
		</div>
	{/if}
	<div class="flex-1 min-w-0">
		{#if children}
			{@render children()}
		{/if}
	</div>

	{#if actions}
		<div class="flex items-center gap-1">
			{@render actions()}
		</div>
	{/if}
</header>
