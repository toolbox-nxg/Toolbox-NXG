/** Tests for coerceSetting and the settings-snapshot read path. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getSettingAsync = vi.hoisted(() => vi.fn())
const setSettingAsync = vi.hoisted(() => vi.fn())
// Real behavior for the pure snapshot reader so `get`/`init` resolve from the passed object.
const getSettingFrom = vi.hoisted(() =>
	vi.fn((settings: Record<string, unknown>, mod: string, key: string, dflt?: unknown,) => {
		const value = settings[`Toolbox.${mod}.${key}`]
		return value == null ? dflt : value
	},)
)

vi.mock('../util/persistence/settings', () => ({getSettingAsync, getSettingFrom, setSettingAsync,}),)

import {coerceSetting, Module,} from './module'

function def (type: string, defaultVal: unknown = undefined,) {
	return {type, default: defaultVal,}
}

/** A test module with two settings and an optional initializer. */
function makeModule (
	initializer?: (values: {count: number; label: string},) => void,
) {
	return new Module<{count: number; label: string}>({
		name: 'Test',
		id: 'Test',
		enabledByDefault: false,
		settings: [
			{id: 'count', type: 'number', default: 3,},
			{id: 'label', type: 'text', default: 'x',},
		],
	}, initializer,)
}

describe('settings snapshot reads', () => {
	beforeEach(() => {
		getSettingAsync.mockReset()
		getSettingFrom.mockClear()
		setSettingAsync.mockReset()
	},)

	it('get reads from a passed snapshot without a storage round-trip', async () => {
		await expect(makeModule().get('count', {'Toolbox.Test.count': 42,},),).resolves.toBe(42,)
		expect(getSettingAsync,).not.toHaveBeenCalled()
	})

	it('get returns the coerced default when the snapshot lacks the key', async () => {
		await expect(makeModule().get('count', {},),).resolves.toBe(3,)
		expect(getSettingAsync,).not.toHaveBeenCalled()
	})

	it('get falls back to a storage read when no snapshot is passed', async () => {
		getSettingAsync.mockResolvedValue(7,)
		await expect(makeModule().get('count',),).resolves.toBe(7,)
		expect(getSettingAsync,).toHaveBeenCalledWith('Test', 'count',)
	})

	it('getEnabled reads the enabled flag from the snapshot', async () => {
		await expect(makeModule().getEnabled({'Toolbox.Test.enabled': true,},),).resolves.toBe(true,)
		// Missing key falls back to enabledByDefault (false here).
		await expect(makeModule().getEnabled({},),).resolves.toBe(false,)
		expect(getSettingAsync,).not.toHaveBeenCalled()
	})

	it('init resolves every initial value from a single snapshot', async () => {
		let received: {count: number; label: string} | undefined
		const module = makeModule((values,) => {
			received = values
		},)
		await module.init({'Toolbox.Test.count': 9, 'Toolbox.Test.label': 'hi',},)
		expect(received,).toEqual({count: 9, label: 'hi',},)
		expect(getSettingAsync,).not.toHaveBeenCalled()
	})
})

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
