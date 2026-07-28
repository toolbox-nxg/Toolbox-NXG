/** Tests for the useAncestorClass hook. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it,} from 'vitest'

import {useAncestorClass,} from './useAncestorClass'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

/** A probe component that applies the hook with the given args. */
function Probe ({target, className, active,}: {target: Element | null; className: string; active: boolean},) {
	useAncestorClass(target, className, active,)
	return null
}

/** Renders the probe into a fresh root and flushes effects. */
async function render (target: Element | null, className: string, active: boolean,): Promise<Root> {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	await act(async () => {
		root.render(<Probe target={target} className={className} active={active} />,)
	},)
	return root
}

afterEach(() => {
	roots.forEach((root,) => act(() => root.unmount()))
	roots.length = 0
	document.body.innerHTML = ''
},)

describe('useAncestorClass', () => {
	it('adds the class on mount when active and removes it on unmount', async () => {
		const target = document.createElement('div',)
		const root = await render(target, 'marker', true,)
		expect(target.classList.contains('marker',),).toBe(true,)
		act(() => root.unmount())
		roots.length = 0
		expect(target.classList.contains('marker',),).toBe(false,)
	})

	it('does nothing when inactive', async () => {
		const target = document.createElement('div',)
		await render(target, 'marker', false,)
		expect(target.classList.contains('marker',),).toBe(false,)
	})

	it('does nothing when target is null', async () => {
		// No target to mark; the hook must simply no-op without throwing.
		await expect(render(null, 'marker', true,),).resolves.toBeDefined()
	})

	it('removes the class when active flips to false and re-adds when it flips back', async () => {
		const target = document.createElement('div',)
		const host = document.createElement('div',)
		document.body.appendChild(host,)
		const root = createRoot(host,)
		roots.push(root,)

		await act(async () => {
			root.render(<Probe target={target} className="marker" active={true} />,)
		},)
		expect(target.classList.contains('marker',),).toBe(true,)

		await act(async () => {
			root.render(<Probe target={target} className="marker" active={false} />,)
		},)
		expect(target.classList.contains('marker',),).toBe(false,)

		await act(async () => {
			root.render(<Probe target={target} className="marker" active={true} />,)
		},)
		expect(target.classList.contains('marker',),).toBe(true,)
	})
})
