<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';

	/**
	 * Floating "New task" button of the phone layout. Positioned by the nearest
	 * `relative` ancestor: the list area above the sync footer, which already
	 * keeps clear of the bottom safe area. The corner follows the text direction
	 * (end side). Scroll areas under it reserve room with `--rt-fab-clearance`
	 * so the last row can scroll out from behind it.
	 *
	 * The green of the status bar in both themes (`--rt-fab` in app.css). Unlike
	 * the yellow button of re/notes, the green has enough edge contrast on the
	 * light list background (about 3.3:1), so the shadow is all the outline it
	 * needs.
	 */
	let { onclick }: { onclick: () => void } = $props();
</script>

<button
	type="button"
	{onclick}
	aria-label={$t('task.create.title')}
	title={$t('task.create.title')}
	class="absolute bottom-4 inset-e-4 z-10 flex h-14 w-14 items-center justify-center rounded-full
         bg-rt-fab text-rt-fab-foreground shadow-lg transition
         hover:brightness-95 active:scale-95 focus-visible:outline-none focus-visible:ring-2
         focus-visible:ring-foreground focus-visible:ring-offset-2
         focus-visible:ring-offset-background"
>
	<Plus class="h-6 w-6" />
</button>
