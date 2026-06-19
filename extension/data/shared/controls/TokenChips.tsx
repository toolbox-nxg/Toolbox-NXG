/**
 * Focus-activated row of clickable token chips under a text field.
 *
 * Wraps an input/textarea; while the field (or a chip) has focus, a row of
 * `{token}` chips appears below it. Clicking a chip splices the token into the
 * field at the caret (replacing any selection) and each chip's `title`
 * explains what the token expands to. Visibility is pure CSS `:focus-within`,
 * and chips prevent default on mousedown so clicking one never blurs the
 * field.
 */

import {type ReactNode, type RefObject,} from 'react'

import css from './TokenChips.module.css'

/** A token offered as a chip: its literal text and a tooltip description. */
export interface TokenChipInfo {
	/** The literal token text including braces, e.g. `{author}`. */
	token: string
	/** What the token expands to, phrased for the chip's tooltip. */
	description: string
}

/** Props for the TokenChips wrapper. */
interface TokenChipsProps {
	/** The tokens to offer, in display order. */
	tokens: TokenChipInfo[]
	/** Ref to the input/textarea the tokens are inserted into. */
	inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
	/** Receives the field's full new value after an insertion. */
	onChange: (next: string,) => void
	/** The input/textarea this row of chips serves. */
	children: ReactNode
}

/** Renders a field with a row of insert-at-cursor token chips shown while it has focus. */
export function TokenChips ({tokens, inputRef, onChange, children,}: TokenChipsProps,) {
	/** Splices `token` into the field at the caret and restores focus after it. */
	const handleInsert = (token: string,) => {
		const field = inputRef.current
		if (!field) { return }
		// The field is a controlled input, so its DOM value matches state.
		const start = field.selectionStart ?? field.value.length
		const end = field.selectionEnd ?? start
		onChange(field.value.slice(0, start,) + token + field.value.slice(end,),)
		// Restore focus with the caret placed after the inserted token.
		requestAnimationFrame(() => {
			field.focus()
			field.setSelectionRange(start + token.length, start + token.length,)
		},)
	}

	return (
		<div className={css.wrap}>
			{children}
			<div className={css.chips}>
				{tokens.map(({token, description,},) => (
					<button
						key={token}
						type="button"
						className={css.chip}
						title={description}
						// Keep focus (and the caret) in the field so :focus-within holds.
						onMouseDown={(e,) => e.preventDefault()}
						onClick={() => handleInsert(token,)}
					>
						{token}
					</button>
				))}
			</div>
		</div>
	)
}
