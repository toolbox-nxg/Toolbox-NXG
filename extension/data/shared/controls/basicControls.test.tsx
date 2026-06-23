/** Tests for basic shared controls. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

vi.mock('../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {ActionButton,} from './ActionButton'
import {ActionSelect,} from './ActionSelect'
import {CheckboxInput,} from './CheckboxInput'
import {GeneralButton,} from './GeneralButton'
import {Icon,} from './Icon'
import {TextInput,} from './NormalInput'
import {NumberInput,} from './NumberInput'
import {TextareaInput,} from './TextareaInput'

const roots: Root[] = []

function render (ui: React.ReactNode,): HTMLElement {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	act(() => {
		root.render(ui,)
	},)
	return host
}

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
},)

describe('basic shared controls', () => {
	it('renders action and general buttons with native button props', () => {
		const onClick = vi.fn()
		const host = render(
			<>
				<ActionButton type="button" primary onClick={onClick}>Save</ActionButton>
				<GeneralButton type="button">Cancel</GeneralButton>
			</>,
		)

		const [save, cancel,] = Array.from(host.querySelectorAll('button',),)
		expect(save.textContent,).toBe('Save',)
		expect(cancel.textContent,).toBe('Cancel',)

		act(() => save.dispatchEvent(new MouseEvent('click', {bubbles: true,},),))

		expect(onClick,).toHaveBeenCalledOnce()
	})

	it('renders text, textarea, number, checkbox, and select controls', () => {
		const checkboxChange = vi.fn()
		const host = render(
			<>
				<TextInput aria-label="name" value="alice" readOnly />
				<TextareaInput label="Body" value="hello" readOnly />
				<NumberInput label="Count" value={3} readOnly />
				<CheckboxInput label="Enabled" checked onChange={checkboxChange} />
				<ActionSelect aria-label="action" value="remove" onChange={() => {}}>
					<option value="approve">approve</option>
					<option value="remove">remove</option>
				</ActionSelect>
			</>,
		)

		expect(host.querySelector<HTMLInputElement>('input[aria-label="name"]',)?.value,).toBe('alice',)
		expect(host.querySelector('textarea',)?.value,).toBe('hello',)
		expect(host.textContent,).toContain('Body',)
		expect(host.textContent,).toContain('Count',)
		expect(host.querySelector<HTMLInputElement>('input[type="number"]',)?.value,).toBe('3',)
		expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]',)?.checked,).toBe(true,)
		expect(host.querySelector<HTMLSelectElement>('select',)?.value,).toBe('remove',)

		act(() => {
			host.querySelector<HTMLInputElement>('input[type="checkbox"]',)!.dispatchEvent(
				new MouseEvent('click', {bubbles: true,},),
			)
		},)

		expect(checkboxChange,).toHaveBeenCalled()
	})

	it('renders icon characters instead of entity text', () => {
		const host = render(<Icon icon="addBox" mood="positive" />,)

		expect(host.querySelector('i',)?.textContent,).not.toContain('&#x',)
		expect(host.querySelector('i',)?.textContent?.length,).toBe(1,)
	})
})
