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
			// Svelte template usage is invisible to @typescript-eslint — rely on svelte-check instead
			'@typescript-eslint/no-unused-vars': 'off',
			// Static option lists (themes, languages, etc.) don't need keys
			'svelte/require-each-key': 'warn'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.d.ts'],
		rules: {
			// DOM globals are valid TS types not known to ESLint
			'no-undef': 'off',
			// Triple-slash references are valid in .d.ts files
			'@typescript-eslint/triple-slash-reference': 'off'
		}
	},
	{
		// Destructuring a prop solely to omit it from a `...rest` spread is a
		// deliberate pattern (e.g. stripping refreshToken from a response body
		// so it's never serialized), not dead code. Excludes *.svelte.ts, where
		// no-unused-vars stays off (template usage is invisible to the TS rule).
		files: ['**/*.ts'],
		ignores: ['**/*.svelte.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }]
		}
	}
];
