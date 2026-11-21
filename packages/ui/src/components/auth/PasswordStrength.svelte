<!-- PasswordStrength.svelte -->
<script lang="ts">
  import { t } from 'svelte-i18n';

  let { password = '' } = $props<{
    password?: string;
  }>();

  interface StrengthLevel {
    score: number;
    /** i18n key of the level's name. */
    labelKey: string;
    color: string;
    bgColor: string;
  }

  const strengthLevels: StrengthLevel[] = [
    {
      score: 0,
      labelKey: 'password.strength.very_weak',
      color: 'text-red-600',
      bgColor: 'bg-red-600'
    },
    {
      score: 1,
      labelKey: 'password.strength.weak',
      color: 'text-orange-600',
      bgColor: 'bg-orange-600'
    },
    {
      score: 2,
      labelKey: 'password.strength.fair',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-600'
    },
    {
      score: 3,
      labelKey: 'password.strength.good',
      color: 'text-blue-600',
      bgColor: 'bg-blue-600'
    },
    {
      score: 4,
      labelKey: 'password.strength.strong',
      color: 'text-green-600',
      bgColor: 'bg-green-600'
    }
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

  /** i18n keys of the requirements the password does not meet yet. */
  function getRequirements(pwd: string): string[] {
    const requirements = [];

    if (pwd.length < 8) {
      requirements.push('password.strength.req_length');
    }
    if (!/[a-z]/.test(pwd) || !/[A-Z]/.test(pwd)) {
      requirements.push('password.strength.req_mixed_case');
    }
    if (!/\d/.test(pwd)) {
      requirements.push('password.strength.req_number');
    }
    if (!/[^A-Za-z0-9]/.test(pwd)) {
      requirements.push('password.strength.req_special');
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
      {$t(currentLevel.labelKey)}
    </span>
    {#if requirements.length > 0}
      <span class="text-xs text-gray-500">
        {$t('password.strength.requirements_left', { values: { count: requirements.length } })}
      </span>
    {/if}
  </div>

  <div class="flex gap-1">
    {#each Array(5) as _, i}
      <div
        class="flex-1 h-1 rounded-full transition-colors {i <= strength
          ? currentLevel.bgColor
          : 'bg-gray-200 dark:bg-gray-700'}"
      ></div>
    {/each}
  </div>

  {#if requirements.length > 0}
    <ul class="mt-2 space-y-1">
      {#each requirements as req (req)}
        <li class="flex items-center text-xs text-gray-600 dark:text-gray-400">
          <svg class="h-3 w-3 me-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          {$t(req)}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-xs text-green-600 dark:text-green-400 flex items-center">
      <svg class="h-3 w-3 me-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      {$t('password.strength.all_met')}
    </p>
  {/if}
</div>
