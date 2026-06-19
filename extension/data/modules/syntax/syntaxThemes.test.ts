/** Tests for syntax themes. */

import {describe, expect, it,} from 'vitest'

import {createThemeSelectElement, syntaxThemes,} from './syntaxThemes'

describe('syntax themes', () => {
	it('creates a select with one option per theme', () => {
		const select = createThemeSelectElement()

		expect(select.id,).toBe('theme_selector',)
		expect(select.options,).toHaveLength(syntaxThemes.length,)
		expect(Array.from(select.options,).map((option,) => option.value),).toEqual([...syntaxThemes,],)
	})
})
