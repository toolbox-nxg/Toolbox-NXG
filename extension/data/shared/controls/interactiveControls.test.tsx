/** Tests for ListInput. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

vi.mock('../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
}),)
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import {ListInput,} from './ListInput'
import {MapInput,} from './MapInput'
import {SingleSelect,} from './SingleSelect'

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

function input (element: HTMLInputElement, value: string,) {
	act(() => {
		const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value',)!.set!
		valueSetter.call(element, value,)
		element.dispatchEvent(new Event('input', {bubbles: true,},),)
	},)
}

function click (element: Element,) {
	act(() => {
		element.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
	},)
}

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
},)

describe('ListInput', () => {
	it('updates, filters blank items, adds rows, and removes rows', () => {
		const onChange = vi.fn()
		const host = render(<ListInput value={['first',]} onChange={onChange} placeholder="item" />,)

		expect(host.querySelectorAll('input',),).toHaveLength(1,)
		input(host.querySelector('input',)!, 'updated',)
		expect(onChange,).toHaveBeenLastCalledWith(['updated',],)

		click(Array.from(host.querySelectorAll('button',),).at(-1,)!,)
		expect(host.querySelectorAll('input',),).toHaveLength(2,)
		expect(onChange,).toHaveBeenLastCalledWith(['updated',],)

		input(host.querySelectorAll('input',)[1]!, 'second',)
		expect(onChange,).toHaveBeenLastCalledWith(['updated', 'second',],)

		click(host.querySelector('button[aria-label="Remove item"]',)!,)
		expect(onChange,).toHaveBeenLastCalledWith(['second',],)
	})
})

describe('MapInput', () => {
	it('decodes initial rows and emits encoded trimmed values', () => {
		const onChange = vi.fn()
		const host = render(
			<MapInput labels={['Key', 'Value',]} value={{'hello%20key': 'hello%20value',}} onChange={onChange} />,
		)
		const inputs = host.querySelectorAll<HTMLInputElement>('input',)

		expect(inputs[0]!.value,).toBe('hello key',)
		expect(inputs[1]!.value,).toBe('hello value',)

		input(inputs[0]!, ' new key ',)
		input(inputs[1]!, ' new value ',)

		expect(onChange,).toHaveBeenLastCalledWith({'new%20key': 'new%20value',},)
	})

	it('only enables adding a row when the last row is complete', () => {
		const onChange = vi.fn()
		const host = render(<MapInput labels={['Key', 'Value',]} value={{}} onChange={onChange} />,)
		const addButton = host.querySelector<HTMLButtonElement>('button[aria-label="Add row"]',)!

		click(addButton,)
		expect(host.querySelectorAll('tbody tr',),).toHaveLength(1,)
		expect(host.querySelector<HTMLButtonElement>('button[aria-label="Add row"]',)!.disabled,).toBe(true,)

		const inputs = host.querySelectorAll<HTMLInputElement>('input',)
		input(inputs[0]!, 'key',)
		expect(host.querySelector<HTMLButtonElement>('button[aria-label="Add row"]',)!.disabled,).toBe(true,)
		input(inputs[1]!, 'value',)
		expect(host.querySelector<HTMLButtonElement>('button[aria-label="Add row"]',)!.disabled,).toBe(false,)
	})
})

describe('SingleSelect', () => {
	it('normalizes labels into radio values and reports changes', () => {
		const onChange = vi.fn()
		const host = render(<SingleSelect options={['First Option', 'Second',]} value="second" onChange={onChange} />,)
		const radios = host.querySelectorAll<HTMLInputElement>('input[type="radio"]',)

		expect(radios[0]!.value,).toBe('first_option',)
		expect(radios[1]!.checked,).toBe(true,)

		click(radios[0]!,)

		expect(onChange,).toHaveBeenCalledWith('first_option',)
	})

	it('shows label overrides while reporting the value derived from the option', () => {
		const onChange = vi.fn()
		const host = render(
			<SingleSelect
				options={['First Option', 'Second',]}
				value="second"
				labels={{'First Option': 'Friendly First',}}
				onChange={onChange}
			/>,
		)
		const labels = host.querySelectorAll('label',)

		// Override text is shown for the mapped option; the unmapped option falls back to its own text.
		expect(labels[0]!.textContent,).toBe('Friendly First',)
		expect(labels[1]!.textContent,).toBe('Second',)

		const radios = host.querySelectorAll<HTMLInputElement>('input[type="radio"]',)
		click(radios[0]!,)

		// The stored value is still derived from the option, not the override label.
		expect(onChange,).toHaveBeenCalledWith('first_option',)
	})
})
