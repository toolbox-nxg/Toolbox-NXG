/** ESLint flat config: lints TS/TSX source (syntactic) + JSX; build scripts stay plain JS. */

import js from '@eslint/js'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Stay on ESLint 9 until eslint-plugin-react publishes peer support for ESLint 10.
const reactRecommended = reactPlugin.configs.recommended
const reactJsxRuntime = reactPlugin.configs['jsx-runtime']

// Rules shared by every TS/TSX source file. Kept in one place so the TS-scoped
// block and any future overrides stay in sync.
const sourceRules = {
	...reactRecommended.rules,
	...reactJsxRuntime.rules,

	'react/prop-types': 'off',
	'one-var-declaration-per-line': ['error', 'always',],
	'one-var': ['error', 'never',],
	'array-callback-return': 'error',
	'guard-for-in': 'error',
	'no-array-constructor': 'error',
	'no-console': 0,
	'no-implied-eval': 'error',
	'no-return-await': 'error',
	'no-sequences': 'error',
	'no-restricted-imports': ['error', {
		patterns: [
			{
				// Private plumbing lives at api/transport/http; feature code goes through api/resources/*.
				// Type-only imports are allowed: they create no runtime coupling to the plumbing.
				group: ['**/api/transport/http', '**/api/transport/http.*',],
				allowTypeImports: true,
				message:
					'Import from an api/resources/* domain module instead; api/transport/http is private API plumbing.',
			},
		],
	},],
	// tseslint recommended turns off core no-unused-vars in favour of its own;
	// carry the project's ignore patterns onto the @typescript-eslint rule.
	'no-unused-vars': 'off',
	'@typescript-eslint/no-unused-vars': ['error', {
		caughtErrorsIgnorePattern: '^_',
		destructuredArrayIgnorePattern: '^_',
		argsIgnorePattern: '^_',
		varsIgnorePattern: '^_',
	},],
	// A hard gate so new explicit `any`/`as any` can't creep back in.
	// Genuine boundary anys carry an inline eslint-disable with a justification.
	'@typescript-eslint/no-explicit-any': 'error',
	'no-var': 'error',
	'no-warning-comments': [
		'error',
		{
			terms: ['XXX', 'NOMERGE',],
			location: 'anywhere',
		},
	],
	// Allow named function-expression callbacks (e.g. Module `function init()`): they aid
	// stack traces and match the project's func-style preference for named declarations.
	'prefer-arrow-callback': ['error', {allowNamedFunctions: true,},],
	'prefer-const': 'error',
	'prefer-numeric-literals': 'error',
	'prefer-rest-params': 'error',
	'prefer-template': 'error',
	'require-await': 'error',
	'arrow-body-style': [
		'error',
		'as-needed',
	],
	'curly': [
		'error',
		'all',
	],
	'eqeqeq': [
		'error',
		'always',
		{
			null: 'ignore',
		},
	],
	'func-style': [
		'error',
		'declaration',
		{
			allowArrowFunctions: true,
		},
	],
	'no-use-before-define': [
		'error',
		'nofunc',
	],
	'object-shorthand': [
		'error',
		'always',
	],
	'operator-assignment': [
		'error',
		'always',
	],
	'quote-props': [
		'error',
		'consistent-as-needed',
	],
	'spaced-comment': [
		'error',
		'always',
	],
	// `rpl` is a Reddit design-system attribute on shreddit elements, not standard HTML.
	'react/no-unknown-property': ['error', {ignore: ['rpl',],},],
	// React Hooks. Deliberately mount-only effects use useMountEffect (util/ui/hooks) and
	// trigger-only effects use useEffectEvent, so real dependency misses stay visible.
	'react-hooks/rules-of-hooks': 'error',
	'react-hooks/exhaustive-deps': 'error',
}

export default tseslint.config(
	{
		ignores: [
			'build/**',
			'docs/**',
			'tests/**',
			'node_modules/**',
			'.venv/**',
			'.idea/**',
			'.settings/**',
			'.vscode/**',
			'extension/data/libs/**',
		],
	},
	js.configs.recommended,
	{
		// Plain-JS build/config/tooling scripts: Node globals, no TS parser, no TS rules.
		// Every .mjs in the repo is a Node script, so match them generically.
		files: [
			'**/*.mjs',
			'eslint.config.js',
			'rollup.config.js',
		],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			// Mirror the source-file ignore patterns so `catch (_)` and friends are allowed here too.
			'no-unused-vars': ['error', {
				caughtErrorsIgnorePattern: '^_',
				destructuredArrayIgnorePattern: '^_',
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			},],
		},
	},
	{
		// TypeScript + JSX source. tseslint.configs.recommended is not self-scoping,
		// so the whole TS stack is confined here via extends.
		files: [
			'**/*.ts',
			'**/*.tsx',
		],
		extends: [...tseslint.configs.recommended,],
		plugins: {
			'react': reactPlugin,
			'react-hooks': reactHooks,
		},
		settings: {
			react: {
				version: 'detect',
			},
		},
		languageOptions: {
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
				ecmaVersion: 'latest',
				sourceType: 'module',
			},
			globals: {
				...globals.browser,
			},
		},
		rules: sourceRules,
	},
	{
		// api/* internal modules legitimately import transport/http; the guard targets feature code.
		files: [
			'extension/data/api/**/*.ts',
		],
		rules: {
			'no-restricted-imports': 'off',
		},
	},
	{
		// Tests use async callbacks deliberately: mock implementations must return promises, and
		// `act(async () => ...)` flushes microtasks even when the callback itself awaits nothing.
		files: [
			'**/*.test.ts',
			'**/*.test.tsx',
		],
		rules: {
			'require-await': 'off',
		},
	},
)
