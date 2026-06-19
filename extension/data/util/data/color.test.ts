/** Tests for color utilities. */

import {describe, expect, it,} from 'vitest'

import {
	autoContrastColor,
	colorNameToHex,
	DARK_THEME_BG,
	invertedDarkVariant,
	isReadableOn,
	LIGHT_THEME_BG,
} from './color'

describe('colorNameToHex', () => {
	it('converts known HTML color names and passes through anything else', () => {
		expect(colorNameToHex('green',),).toBe('#008000',)
		expect(colorNameToHex('#123456',),).toBe('#123456',)
	})
})

describe('invertedDarkVariant', () => {
	it('reproduces the hardcoded dark defaults derived from the classic dark-mode filter', () => {
		expect(invertedDarkVariant('green',),).toBe('#53b953',)
		expect(invertedDarkVariant('fuchsia',),).toBe('#ff71ff',)
		expect(invertedDarkVariant('purple',),).toBe('#ffabff',)
		expect(invertedDarkVariant('red',),).toBe('#ff8f8f',)
		expect(invertedDarkVariant('darkred',),).toBe('#ffb6b6',)
		expect(invertedDarkVariant('black',),).toBe('#e6e6e6',)
		// abusewarn's default is hand-tuned instead because the filter output is too dim.
		expect(invertedDarkVariant('orange',),).toBe('#9e5600',)
	})

	it('keeps grays near-neutral (hue rotation only drifts by float rounding)', () => {
		expect(invertedDarkVariant('#ffffff',),).toBe('#191a19',)
	})
})

describe('isReadableOn', () => {
	it('checks contrast against the representative theme backgrounds', () => {
		expect(isReadableOn('black', LIGHT_THEME_BG,),).toBe(true,)
		expect(isReadableOn('white', LIGHT_THEME_BG,),).toBe(false,)
		expect(isReadableOn('#e6e6e6', DARK_THEME_BG,),).toBe(true,)
		// The raw filter output for orange fails on dark, which is why the
		// shipped default is hand-tuned to #ffb347.
		expect(isReadableOn('#9e5600', DARK_THEME_BG,),).toBe(false,)
		expect(isReadableOn('#ffb347', DARK_THEME_BG,),).toBe(true,)
	})
})

describe('autoContrastColor', () => {
	it('returns already-readable colors unchanged (normalized to hex)', () => {
		expect(autoContrastColor('black', LIGHT_THEME_BG,),).toBe('#000000',)
	})

	it('nudges failing colors to meet AA contrast while keeping their hue', () => {
		const fixedLight = autoContrastColor('#9e5600', DARK_THEME_BG,)
		expect(isReadableOn(fixedLight, DARK_THEME_BG,),).toBe(true,)

		const fixedDark = autoContrastColor('yellow', LIGHT_THEME_BG,)
		expect(isReadableOn(fixedDark, LIGHT_THEME_BG,),).toBe(true,)
	})
})
