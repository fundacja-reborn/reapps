<!-- PasswordStrength.svelte -->
<script lang="ts">
  let { password = '' } = $props<{
    password?: string;
  }>();
  
  interface StrengthLevel {
    score: number;
    label: string;
    color: string;
    bgColor: string;
  }
  
  const strengthLevels: StrengthLevel[] = [
    { score: 0, label: 'Very Weak', color: 'text-red-600', bgColor: 'bg-red-600' },
    { score: 1, label: 'Weak', color: 'text-orange-600', bgColor: 'bg-orange-600' },
    { score: 2, label: 'Fair', color: 'text-yellow-600', bgColor: 'bg-yellow-600' },
    { score: 3, label: 'Good', color: 'text-blue-600', bgColor: 'bg-blue-600' },
    { score: 4, label: 'Strong', color: 'text-green-600', bgColor: 'bg-green-600' }
  ];
  
  function calculateStrength(pwd: string): number {
    let score = 0;
    
    if (!pwd) return score;
    
    // Length
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    
    // Complexity
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++; // Mixed case
    if (/\d/.test(pwd)) score++; // Numbers
    if (/[^A-Za-z0-9]/.test(pwd)) score++; // Special characters
    
    // Adjust score to 0-4 range
    return Math.min(Math.floor(score * 0.8), 4);
  }
  
  function getRequirements(pwd: string): string[] {
    const requirements = [];
    
    if (pwd.length < 8) {
      requirements.push('At least 8 characters');
    }
    if (!/[a-z]/.test(pwd) || !/[A-Z]/.test(pwd)) {
      requirements.push('Upper and lowercase letters');
    }
    if (!/\d/.test(pwd)) {
      requirements.push('At least one number');
    }
    if (!/[^A-Za-z0-9]/.test(pwd)) {
      requirements.push('At least one special character');
    }
    
    return requirements;
  }
  
  const strength = $derived(calculateStrength(password));
  const currentLevel = $derived(strengthLevels[strength]);
  const requirements = $derived(getRequirements(password));
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between">
    <span class="text-xs font-medium {currentLevel.color}">
      {currentLevel.label}
    </span>
    {#if requirements.length > 0}
      <span class="text-xs text-gray-500">
        {requirements.length} requirement{requirements.length > 1 ? 's' : ''} left
      </span>
    {/if}
  </div>
  
  <div class="flex space-x-1">
    {#each Array(5) as _, i}
      <div
        class="flex-1 h-1 rounded-full transition-colors {i <= strength ? currentLevel.bgColor : 'bg-gray-200 dark:bg-gray-700'}"
      ></div>
    {/each}
  </div>
  
  {#if requirements.length > 0}
    <ul class="mt-2 space-y-1">
      {#each requirements as req}
        <li class="flex items-center text-xs text-gray-600 dark:text-gray-400">
          <svg class="h-3 w-3 mr-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
          {req}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-xs text-green-600 dark:text-green-400 flex items-center">
      <svg class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      Password meets all requirements
    </p>
  {/if}
</div>

<style>
  /* Custom styles if needed */
</style>
