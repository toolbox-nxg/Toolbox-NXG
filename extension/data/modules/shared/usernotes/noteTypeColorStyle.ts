/** Theme-aware inline color styling for usernote type colors. */

import type {CSSProperties,} from 'react'

import type {UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'

/**
 * Builds an inline style rendering a note type's light color in light mode
 * and its dark color (falling back to the light color) in dark mode, with no
 * JS theme detection: the `--toolbox-theme-light`/`--toolbox-theme-dark`
 * space toggles defined in base.css make exactly one of the two intermediate
 * custom properties valid, and the `var()` fallback chain picks whichever
 * survived.
 * @returns The style object, or `undefined` when the type has no color set.
 */
export function noteTypeColorStyle (type: Pick<UserNoteColor, 'color' | 'colorDark'>,): CSSProperties | undefined {
	const light = type.color || type.colorDark
	if (!light) { return undefined }
	const dark = type.colorDark || light
	return {
		'--note-color-if-light': `var(--toolbox-theme-light) ${light}`,
		'--note-color-if-dark': `var(--toolbox-theme-dark) ${dark}`,
		'color': 'var(--note-color-if-light, var(--note-color-if-dark))',
	} as CSSProperties
}
