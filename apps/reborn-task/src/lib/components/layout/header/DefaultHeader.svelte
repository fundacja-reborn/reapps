<!-- 
	@component
	Default header component displaying application logo
-->
<script lang="ts">
	import { base } from '$app/paths';
</script>

<img src="{base}/logo-black.svg" alt="re/task" class="h-4 w-auto block dark:hidden" />
<img
	src="{base}/logo-white.svg"
	alt="re/task"
	class="h-4 w-auto hidden dark:block dark:opacity-80"
/>
