import {RuleTester,} from 'oxlint/plugins-dev'
import {describe, expect, it,} from 'vitest'

import paramConventions, {parseParamTags,} from './param-conventions.mjs'
import {ROOT,} from './paths.mjs'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester()
const filename = `${ROOT}/extension/data/modules/example/dom.ts`
const violation = (kind, fn, detail,) => ({messageId: 'violation', data: {kind, fn, detail,},})

describe('toolbox/param-conventions', () => {
	tester.run('param-conventions', paramConventions, {
		valid: [
			'function f (subreddit: string, user: string, text: string) {}',
			// Unrecognized params and options objects don't take part in ordering.
			'function f (target: Element, subreddit: string, {id}: {id: string}) {}',
			// `this` parameters are type-only.
			'function f (this: Window, subreddit: string) {}',
			// Constructors and accessors are not checked.
			'class A { constructor (sub: string) {} set value (sub: string) {} }',
			'const o = { set value (sub: string) {} }',
			// Documented names that match the signature, including sub-property tags.
			'/**\n * @param subreddit The sub.\n * @param options Extra.\n */ function f (subreddit: string, options: object) {}',
			// `@param` inside an inline tag or glued to a word is prose, not a tag.
			'/** @param subreddit See {@link x @param user}, or mail@param.example. */ function f (subreddit: string) {}',
			`/**
			 * @param {string} subreddit The sub.
			 * @param options Settings.
			 * @param options.limit How many.
			 */
			export function f (subreddit: string, options: {limit: number}) {}`,
			// A bare name may document a destructured bag as a whole.
			'/** @param settings All of them. */ function f ({a, b}: {a: 1, b: 2}) {}',
			// JSDoc on an unrelated outer declaration does not apply to a callback inside it.
			'/** @param x Not this arrow. */ const handlers = register((subreddit: string) => {})',
			// Tests are out of scope.
			{code: 'function f (sub: string) {}', filename: `${ROOT}/extension/data/modules/example/dom.test.ts`,},
		].map((test,) => typeof test === 'string' ? {code: test, filename,} : test),
		invalid: [
			{
				code: 'function f (id: string, subreddit: string) {}',
				filename,
				errors: [
					violation(
						'ORDER',
						'f',
						'`subreddit` (subreddit) appears after `id` (id) but should come before it. Actual order: (id, subreddit).',
					),
				],
			},
			{
				code: 'const f = (sub: string, {username}: {username: string}) => {}',
				filename,
				errors: [
					violation('NAMING', 'f', 'parameter `sub` should be named `subreddit`.',),
					violation('NAMING', 'f', 'parameter `username` should be named `user`.',),
				],
			},
			{
				code: 'class A { load (sub = "x", ...post: string[]) {} }',
				filename,
				errors: [
					violation('NAMING', 'load', 'parameter `sub` should be named `subreddit`.',),
					violation('NAMING', 'load', 'parameter `post` should be named `submission`.',),
				],
			},
			{
				// JSDoc on the variable statement applies to the arrow it initializes.
				code: '/** @param subreddit The sub. */\nexport const f = (subreddit: string, user: string) => {}',
				filename,
				errors: [violation('JSDOC', 'f', 'missing @param for `user`.',),],
			},
			{
				code:
					'/**\n * @param user Who.\n * @param subreddit Where.\n */\nfunction f (subreddit: string, user: string) {}',
				filename,
				errors: [
					violation(
						'JSDOC',
						'f',
						'@param order (user, subreddit) does not match signature order (subreddit, user).',
					),
				],
			},
			{
				code:
					'const o = {\n\t/**\n\t * @arg [subreddit=funny] Where.\n\t * @param extra Gone.\n\t */\n\tload: function (subreddit) {},\n}',
				filename,
				errors: [violation('JSDOC', 'load', '@param documents unknown `extra`.',),],
			},
			{
				code: '/** @param opts.limit How many. */ function f ({limit}: {limit: number}) {}',
				filename,
				errors: [violation('JSDOC', 'f', '@param documents unknown `opts.limit`.',),],
			},
		],
	},)
})

describe('parseParamTags', () => {
	it('reads names from the documented forms', () => {
		expect(
			parseParamTags(
				'* @param a First.\n * @param {string} b Second.\n * @param [c] Opt.\n * @param {number} [d=1] Def.\n * @arg e\n * @argument f.g',
			),
		)
			.toEqual(['a', 'b', 'c', 'd', 'e', 'f.g',],)
	})
	it('counts tags after whitespace, as TypeScript does, but not inside inline tags', () => {
		expect(
			parseParamTags(
				'* @param a One. @param b Two.\n * more @param c\n * {@link x @param d} (@param e) f@param g',
			),
		)
			.toEqual(['a', 'b', 'c',],)
	})
	it('skips nested braces in type expressions', () => {
		expect(parseParamTags('* @param {{a: {b: string}}} options The bag.',),).toEqual(['options',],)
	})
})
