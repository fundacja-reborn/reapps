import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: ['**/build/**', '**/.svelte-kit/**', '**/dist/**', '**/node_modules/**']
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'svelte/require-each-key': 'warn'
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.d.ts'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/triple-slash-reference': 'off'
    }
  }
];
