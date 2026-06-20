import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import reactPlugin from 'eslint-plugin-react'
import globals from 'globals'

// Stay on ESLint 9 until these plugins publish peer support for ESLint 10.
const reactRecommended = reactPlugin.configs.recommended
const reactJsxRuntime = reactPlugin.configs['jsx-runtime']

export default [
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
	importPlugin.flatConfigs.recommended,
	{
		files: [
			'eslint.config.js',
			'scripts/release.mjs',
			'rollup.config.js',
		],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		plugins: {
			react: reactPlugin,
		},
		settings: {
			react: {
				version: 'detect',
			},
		},
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
			globals: {
				...globals.browser,
			},
		},
		rules: {
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
						group: ['**/api/http', '**/api/http.*',],
						message: 'Import from an api/* domain module instead; api/http is private API plumbing.',
					},
				],
			},],
			'no-unused-vars': ['error', {
				caughtErrorsIgnorePattern: '^_',
				destructuredArrayIgnorePattern: '^_',
			},],
			'no-var': 'error',
			'no-warning-comments': [
				'error',
				{
					terms: ['XXX', 'NOMERGE',],
					location: 'anywhere',
				},
			],
			'prefer-arrow-callback': 'error',
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
		},
	},
]
