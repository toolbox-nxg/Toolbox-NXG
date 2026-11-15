/** Tests for the useEscapeKey modal-stacking discipline and the useLoaded keyed loader. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

import {type Loaded, useEscapeKey, useLoaded,} from './hooks'
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

describe('useLoaded', () => {
	/** A load whose results are resolved by hand, per key. */
	function controlledLoad () {
		const pending = new Map<string, {resolve: (value: string,) => void; reject: (error: Error,) => void}>()
		const load = vi.fn((key: string,) =>
			new Promise<string>((resolve, reject,) => {
				pending.set(key, {resolve, reject,},)
			},)
		)
		return {load, pending,}
	}

	let outcome: Loaded<string> = {status: 'loading',}
	function Probe ({k, load,}: {k: string; load: (key: string,) => Promise<string>},) {
		outcome = useLoaded(k, load,)
		return null
	}

	function render () {
		const host = document.createElement('div',)
		document.body.appendChild(host,)
		const root = createRoot(host,)
		mounted.add({root, host,},)
		return (k: string, load: (key: string,) => Promise<string>,) =>
			act(() => root.render(<Probe k={k} load={load} />,))
	}

	it('is loading until the load settles, then ready with its value', async () => {
		const {load, pending,} = controlledLoad()
		const rerender = render()
		rerender('a', load,)
		expect(outcome,).toEqual({status: 'loading',},)
		await act(async () => pending.get('a',)!.resolve('A',))
		expect(outcome,).toEqual({status: 'ready', value: 'A',},)
	})

	it('goes back to loading as soon as the key changes, and drops a late result for the old key', async () => {
		const {load, pending,} = controlledLoad()
		const rerender = render()
		rerender('a', load,)
		await act(async () => pending.get('a',)!.resolve('A',))

		rerender('b', load,)
		// Still loading for the new key, with the previous key's value offered as stale.
		expect(outcome,).toEqual({status: 'loading', stale: 'A',},)
		rerender('c', load,)
		await act(async () => pending.get('b',)!.resolve('B',))
		expect(outcome,).toEqual({status: 'loading', stale: 'A',},)
		await act(async () => pending.get('c',)!.resolve('C',))
		expect(outcome,).toEqual({status: 'ready', value: 'C',},)
		expect(load,).toHaveBeenCalledTimes(3,)
	})

	it('reports a rejected load as an error', async () => {
		const {load, pending,} = controlledLoad()
		render()('a', load,)
		const error = new Error('nope',)
		await act(async () => pending.get('a',)!.reject(error,))
		expect(outcome,).toEqual({status: 'error', error,},)
	})

	it('reports a load that throws before returning a promise as an error', async () => {
		const error = new Error('sync',)
		await act(async () =>
			render()('a', () => {
				throw error
			},)
		)
		expect(outcome,).toEqual({status: 'error', error,},)
	})
})
