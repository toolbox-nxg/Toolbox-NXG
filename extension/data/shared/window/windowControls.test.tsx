/** Tests for Backdrop. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

vi.mock('../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {Backdrop,} from './Backdrop'
import {WindowTabs,} from './WindowTabs'

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

function click (element: Element,) {
	act(() => {
		element.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
	},)
}

function pointerUp (element: Element,) {
	act(() => {
		element.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0, isPrimary: true,},),)
	},)
}

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
},)

describe('Backdrop', () => {
	it('calls onClickOutside for backdrop clicks and Escape', () => {
		const onClickOutside = vi.fn()
		const host = render(
			<Backdrop onClickOutside={onClickOutside}>
				<button>inside</button>
			</Backdrop>,
		)
		const backdrop = host.firstElementChild!

		click(host.querySelector('button',)!,)
		expect(onClickOutside,).not.toHaveBeenCalled()

		click(backdrop,)
		expect(onClickOutside,).toHaveBeenCalledOnce()

		act(() => {
			document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape',},),)
		},)
		expect(onClickOutside,).toHaveBeenCalledTimes(2,)
	})

	it('removes Escape listeners when unmounted', () => {
		const onClickOutside = vi.fn()
		render(<Backdrop onClickOutside={onClickOutside}>content</Backdrop>,)
		act(() => roots.pop()!.unmount())

		act(() => {
			document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape',},),)
		},)

		expect(onClickOutside,).not.toHaveBeenCalled()
	})
})

describe('WindowTabs', () => {
	it('renders the default tab, switches tabs, and calls onTabChange', () => {
		const onTabChange = vi.fn()
		const host = render(
			<WindowTabs
				defaultTabIndex={1}
				tabs={[
					{kind: 'section', label: 'General',},
					{title: 'One', content: <p>First content</p>,},
					{title: 'Two', content: <p>Second content</p>,},
				]}
				onTabChange={onTabChange}
				footer={<span>Footer content</span>}
			/>,
		)

		expect(host.textContent,).toContain('Second content',)
		expect(host.textContent,).toContain('Footer content',)

		click(host.querySelectorAll('[role="tab"]',)[0]!,)

		expect(host.textContent,).toContain('First content',)
		expect(onTabChange,).toHaveBeenCalledWith(0,)
	})

	it('renders tab toggles without switching tabs when toggled', () => {
		const onToggle = vi.fn()
		const host = render(
			<WindowTabs
				defaultTabIndex={0}
				tabs={[
					{
						title: 'Module',
						content: <p>Module content</p>,
						toggle: {checked: false, onChange: onToggle,},
					},
					{title: 'Other', content: <p>Other content</p>,},
				]}
			/>,
		)
		const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]',)!

		click(checkbox,)

		expect(onToggle,).toHaveBeenCalledWith(true,)
		expect(host.textContent,).toContain('Module content',)
		expect(host.textContent,).not.toContain('Other content',)
	})

	it('does not switch tabs when pointerup happens on a tab toggle', () => {
		const onToggle = vi.fn()
		const host = render(
			<WindowTabs
				defaultTabIndex={0}
				tabs={[
					{
						title: 'Module',
						content: <p>Module content</p>,
						toggle: {checked: false, onChange: onToggle,},
					},
					{title: 'Other', content: <p>Other content</p>,},
				]}
			/>,
		)
		const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]',)!

		pointerUp(checkbox,)

		expect(host.textContent,).toContain('Module content',)
		expect(host.textContent,).not.toContain('Other content',)
	})
})
