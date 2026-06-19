/** Tests for coerceSetting. */

// @vitest-environment node
import {describe, expect, it, vi,} from 'vitest'

vi.mock('../util/persistence/settings', () => ({}),)

import {coerceSetting,} from './module'

function def (type: string, defaultVal: unknown = undefined,) {
	return {type, default: defaultVal,}
}

describe('coerceSetting', () => {
	describe('boolean', () => {
		it('passes through true', () => expect(coerceSetting(def('boolean', false,), true,),).toBe(true,))
		it('passes through false', () => expect(coerceSetting(def('boolean', true,), false,),).toBe(false,))
		it('falls back to default for string "true"', () =>
			expect(coerceSetting(def('boolean', false,), 'true',),).toBe(false,))
		it('falls back to default for number 1', () => expect(coerceSetting(def('boolean', true,), 1,),).toBe(true,))
	})

	describe('number', () => {
		it('passes through a number', () => expect(coerceSetting(def('number', 0,), 42,),).toBe(42,))
		it('coerces a numeric string', () => expect(coerceSetting(def('number', 0,), '7',),).toBe(7,))
		it('falls back to default for NaN string', () => expect(coerceSetting(def('number', 5,), 'abc',),).toBe(5,))
		it('falls back to default for array', () => expect(coerceSetting(def('number', 3,), [],),).toBe(3,))
	})

	describe('string types (text, textarea, code, syntaxTheme, selector, subreddit)', () => {
		for (const type of ['text', 'textarea', 'code', 'syntaxTheme', 'selector', 'subreddit',] as const) {
			it(`passes through a string for ${type}`, () =>
				expect(coerceSetting(def(type, '',), 'hello',),).toBe('hello',))
			it(`falls back to default for number in ${type}`, () =>
				expect(coerceSetting(def(type, 'default',), 123,),).toBe('default',))
		}
	})

	describe('array / list / sublist', () => {
		for (const type of ['array', 'list', 'sublist',] as const) {
			it(`passes through an array for ${type}`, () =>
				expect(coerceSetting(def(type, [],), ['a', 'b',],),).toEqual(['a', 'b',],))
			it(`falls back to default for string in ${type}`, () =>
				expect(coerceSetting(def(type, ['x',],), 'oops',),).toEqual(['x',],))
		}
	})

	describe('map', () => {
		it('passes through a plain object', () =>
			expect(coerceSetting(def('map', {},), {a: 'b',},),).toEqual({a: 'b',},))
		it('falls back to default for an array', () =>
			expect(coerceSetting(def('map', {z: 'z',},), ['a',],),).toEqual({z: 'z',},))
		it('falls back to default for null', () =>
			expect(coerceSetting(def('map', {z: 'z',},), null,),).toEqual({z: 'z',},))
		it('falls back to default for a string', () => expect(coerceSetting(def('map', {},), 'oops',),).toEqual({},))
	})

	describe('page', () => {
		it('passes through any value unchanged', () => {
			const val = {complex: true,}
			expect(coerceSetting(def('page',), val,),).toBe(val,)
		})
	})

	describe('function default', () => {
		it('calls the default factory when falling back', () => {
			const factory = () => 99
			expect(coerceSetting({type: 'number', default: factory,}, 'NaN',),).toBe(99,)
		})
	})
})
