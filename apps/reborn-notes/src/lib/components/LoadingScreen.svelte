<div
  class="svelte-app-ready fixed inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900"
>
  <div class="text-center">
    <div class="loading-spinner"></div>
    <p class="text-gray-600 dark:text-gray-400">Initializing application...</p>
  </div>
</div>

<style>
  .loading-spinner {
    width: 32px;
    height: 32px;
    margin: 0 auto 16px;
    border: 3px solid rgb(229 231 235);
    border-top-color: rgb(59 130 246);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  :global(.dark) .loading-spinner {
    border-color: rgb(55 65 81);
    border-top-color: rgb(96 165 250);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
