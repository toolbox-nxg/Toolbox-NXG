/** Tests for BanForm keyboard order between the internal note and the message sent to the user. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {
		runtime: {sendMessage: vi.fn(), getURL: vi.fn((path: string,) => path),},
		storage: {local: {get: vi.fn().mockResolvedValue({},),},},
	},
}),)

import {BanForm,} from './BanForm'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
	act(() => {
		roots.forEach((root,) => root.unmount())
	},)
	roots.length = 0
	document.body.innerHTML = ''
},)

/** Renders a BanForm with the "from notes" button shown and no-op callbacks. */
function renderForm () {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	act(() => {
		root.render(
			<BanForm
				banNote=""
				onBanNoteChange={vi.fn()}
				banMessage=""
				onBanMessageChange={vi.fn()}
				banDuration=""
				onBanDurationChange={vi.fn()}
				banPermanent={false}
				showCustomDuration={false}
				banDurationPresets={[1, 7,]}
				removeAll={false}
				removeAllNotify={true}
				effectiveMaxMessage={1000}
				notesSuggestError=""
				showFromNotes={true}
				onSuggestFromNotes={vi.fn()}
				onSelectPreset={vi.fn()}
				onSelectPermanent={vi.fn()}
				onSelectCustom={vi.fn()}
				onRemoveAllChange={vi.fn()}
				onRemoveAllNotifyChange={vi.fn()}
				savedBanMacros={[]}
				onApplyBanMacro={vi.fn()}
			/>,
		)
	},)
	return host
}

describe('BanForm tab order', () => {
	it('tabs straight from the internal note to the message sent to the user', () => {
		const host = renderForm()
		// Elements reachable by Tab, in document order (none of these use a positive tabIndex).
		const tabbable = [...host.querySelectorAll<HTMLElement>('input, textarea, button, select, a[href]',),]
			.filter((el,) => el.tabIndex >= 0)
		const note = host.querySelector('input[placeholder="(ban note - internal)"]',)
		const message = host.querySelector('textarea[placeholder="(ban message - sent to user)"]',)

		expect(note,).not.toBeNull()
		expect(tabbable[tabbable.findIndex((el,) => el === note) + 1],).toBe(message,)
	})

	it('still shows the from notes button', () => {
		const host = renderForm()
		const buttons = [...host.querySelectorAll('button',),].map((b,) => b.textContent)

		expect(buttons,).toContain('from notes',)
	})
})
