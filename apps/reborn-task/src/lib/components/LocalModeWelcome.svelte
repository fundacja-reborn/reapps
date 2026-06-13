<!--
  First-run explainer for local-only / no-account mode. Shown exactly once per
  browser profile: the marker is written the moment the dialog opens, so any way
  of dismissing it (button, Esc, overlay) still counts as "seen". The copy is
  deliberately honest about the trade-off (no server, no cloud recovery) - this
  is the privacy pitch, not fine print. See planning/local-only-no-account-plan.md.
-->
<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter,
		Button
	} from '@reborn/ui';
	import { browser } from '$app/environment';
	import { isLocalOnly } from '$lib/stores/auth.store';
	import { t } from '$lib/stores/i18n.store';

	const WELCOMED_KEY = 'reborn_local_mode_welcomed';
	let open = $state(false);

	$effect(() => {
		if (!browser) return;
		if ($isLocalOnly && localStorage.getItem(WELCOMED_KEY) !== '1') {
			open = true;
			// Mark as seen on open so it shows exactly once regardless of how it's closed.
			try {
				localStorage.setItem(WELCOMED_KEY, '1');
			} catch {
				/* private mode / storage disabled - worst case it shows again, harmless */
			}
		}
	});
</script>

<Dialog bind:open>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{$t('local_mode.welcome.title')}</DialogTitle>
			<DialogDescription>{$t('local_mode.welcome.subtitle')}</DialogDescription>
		</DialogHeader>

		<ul class="space-y-3 py-2 text-sm text-muted-foreground">
			<li class="flex gap-2">
				<span aria-hidden="true">•</span>
				<span>{$t('local_mode.welcome.point_storage')}</span>
			</li>
			<li class="flex gap-2">
				<span aria-hidden="true">•</span>
				<span>{$t('local_mode.welcome.point_encrypted')}</span>
			</li>
			<li class="flex gap-2">
				<span aria-hidden="true">•</span>
				<span>{$t('local_mode.welcome.point_no_sync')}</span>
			</li>
			<li class="flex gap-2 font-medium text-foreground">
				<span aria-hidden="true">•</span>
				<span>{$t('local_mode.welcome.point_no_recovery')}</span>
			</li>
			<li class="flex gap-2">
				<span aria-hidden="true">•</span>
				<span>{$t('local_mode.welcome.point_upgrade')}</span>
			</li>
		</ul>

		<DialogFooter>
			<Button onclick={() => (open = false)}>
				{$t('local_mode.welcome.cta')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
