<!-- 
	@component
	Header component for trash page displaying icon and title
-->
<script lang="ts">
	import { Trash2 } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
</script>

<div class="flex items-center gap-2">
	<Trash2 class="h-5 w-5" />
	<span class="text-md font-medium">{$t('task.trash.title')}</span>
</div>
