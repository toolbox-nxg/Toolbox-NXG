/** Tests for the useEscapeKey modal-stacking discipline. */

// @vitest-environment jsdom
import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

import {useEscapeKey,} from './hooks'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/** Test component that registers an Escape handler. */
function EscapeComponent ({cb,}: {cb: (() => void) | undefined},) {
	useEscapeKey(cb,)
	return null
}

const mounted = new Set<{root: Root; host: HTMLElement}>()

/** Mounts an EscapeComponent and returns an unmount function. */
function mount (cb: (() => void) | undefined,): () => void {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	const entry = {root, host,}
	mounted.add(entry,)
	act(() => root.render(<EscapeComponent cb={cb} />,))
	return () => {
		if (!mounted.has(entry,)) { return }
		mounted.delete(entry,)
		act(() => root.unmount())
		host.remove()
	}
}

function pressEscape () {
	act(() => {
		document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape',},),)
	},)
}

afterEach(() => {
	for (const {root, host,} of mounted) {
		act(() => root.unmount())
		host.remove()
	}
	mounted.clear()
},)

describe('useEscapeKey stacking', () => {
	it('fires only the top-most handler, then the next once it unmounts', () => {
		const cb1 = vi.fn()
		const cb2 = vi.fn()
		mount(cb1,) // opened first (bottom)
		const unmountTop = mount(cb2,) // opened second (top)

		pressEscape()
		expect(cb2,).toHaveBeenCalledTimes(1,)
		expect(cb1,).not.toHaveBeenCalled()

		// Closing the top dialog lets the next Escape reach the one beneath it.
		unmountTop()
		pressEscape()
		expect(cb1,).toHaveBeenCalledTimes(1,)
		expect(cb2,).toHaveBeenCalledTimes(1,)
	})

	it('skips an opted-out (undefined) top handler and falls through', () => {
		const cb1 = vi.fn()
		mount(cb1,)
		mount(undefined,) // top, but not handling Escape

		pressEscape()
		expect(cb1,).toHaveBeenCalledTimes(1,)
	})
})
