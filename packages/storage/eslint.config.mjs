import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs}',
            '{projectRoot}/vite.config.{js,ts,mjs,mts}',
            '{projectRoot}/vitest.config.{js,ts,mjs,mts}'
          ],
          // None of these are bundled runtime deps of this library, so they
          // need not appear in "dependencies":
          //  - vitest, tsup: test runner / bundler (devDependencies only)
          //  - svelte: marked `external` in tsup.config.ts; the consuming app
          //    provides it (a peer), it is not bundled into dist.
          ignoredDependencies: ['vitest', 'tsup', 'svelte']
        }
      ]
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser')
    }
  }
];
