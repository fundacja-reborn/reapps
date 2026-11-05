import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist']
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?js$',
            // Repo-level dev tooling imported by guard specs: the `scripts`
            // project (scripts/project.json) is not a package, so specs reach
            // it by relative path. Nx still records the dependency from these
            // imports, so a change in scripts/ runs the specs that test it.
            '^.*/scripts/(check-rtl-direction|supported-locales|i18n-messages|i18n-export|i18n-import|i18n-review)\\.mjs$'
          ],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*']
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs'
    ],
    // Override or add rules here
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
];
