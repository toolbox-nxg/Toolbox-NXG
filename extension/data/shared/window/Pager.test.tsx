/** Tests for Pager: eager and lazy loading, the page kept on screen while loading, and iterator changes. */

import {act, type ReactNode,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

vi.mock('../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {Pager,} from './Pager'

const roots: Root[] = []

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
},)

/** Mounts a root whose content can be re-rendered with new props. */
function mount () {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	return {
		host,
		render: async (ui: ReactNode,) => {
			await act(async () => root.render(ui,))
		},
	}
}

/** An async iterable whose pages are handed out one `resolve` call at a time. */
function controlledPages () {
	const waiting: Array<(result: IteratorResult<ReactNode, void>,) => void> = []
	return {
		pages: {
			[Symbol.asyncIterator]: () => ({
				next: () => new Promise<IteratorResult<ReactNode, void>>((resolve,) => waiting.push(resolve,)),
			}),
		},
		/** Resolves the oldest pending `next()` with a page, or with `done` when `page` is omitted. */
		resolve: async (page?: string,) => {
			await act(async () => {
				waiting.shift()!(
					page === undefined ? {value: undefined, done: true,} : {value: <p>{page}</p>, done: false,},
				)
			},)
		},
		pending: () => waiting.length,
	}
}

const buttonLabels = (host: HTMLElement,) => [...host.querySelectorAll('button',),].map((b,) => b.textContent)

const clickButton = async (host: HTMLElement, label: string,) => {
	const button = [...host.querySelectorAll('button',),].find((b,) => b.textContent === label)!
	await act(async () => button.dispatchEvent(new MouseEvent('click', {bubbles: true,},),))
}

describe('Pager', () => {
	it('reads every page up front when not lazy', async () => {
		const {host, render,} = mount()
		await render(<Pager lazy={false} controlPosition="top" emptyContent="empty" pages={['A', 'B', 'C',]} />,)
		expect(buttonLabels(host,),).toEqual(['1', '2', '3',],)
		expect(host.textContent,).toContain('A',)
		await clickButton(host, '3',)
		expect(host.textContent,).toContain('C',)
	})

	it('shows the empty content for an iterable with no pages', async () => {
		const {host, render,} = mount()
		await render(<Pager controlPosition="top" emptyContent="Nothing here" pages={[]} />,)
		expect(host.textContent,).toContain('Nothing here',)
		expect(buttonLabels(host,),).toEqual([],)
	})

	it('loads lazily, keeping the current page on screen while the next one loads', async () => {
		const source = controlledPages()
		const {host, render,} = mount()
		await render(<Pager controlPosition="top" emptyContent="empty" pages={source.pages} />,)
		expect(host.textContent,).toContain('Loading...',)

		await source.resolve('Page one',)
		expect(host.textContent,).toContain('Page one',)
		expect(source.pending(),).toBe(0,)

		await clickButton(host, 'load more...',)
		expect(source.pending(),).toBe(1,)
		expect(host.textContent,).toContain('Page one',)
		expect(buttonLabels(host,),).toContain('loading...',)

		await source.resolve('Page two',)
		expect(host.textContent,).toContain('Page two',)
		expect(buttonLabels(host,),).toEqual(['1', '2', 'load more...',],)
	})

	it('snaps back to the last page when "load more" finds the iterator finished', async () => {
		const source = controlledPages()
		const {host, render,} = mount()
		await render(<Pager controlPosition="top" emptyContent="empty" pages={source.pages} />,)
		await source.resolve('Only page',)
		await clickButton(host, 'load more...',)
		await source.resolve()
		expect(host.textContent,).toContain('Only page',)
		expect(buttonLabels(host,),).toEqual(['1',],)
	})

	it('starts over for new pages, keeping the old page up until the first new one arrives', async () => {
		const first = controlledPages()
		const second = controlledPages()
		const {host, render,} = mount()
		await render(<Pager controlPosition="top" emptyContent="empty" pages={first.pages} />,)
		await first.resolve('Old one',)
		await clickButton(host, 'load more...',)
		expect(first.pending(),).toBe(1,)

		await render(<Pager controlPosition="top" emptyContent="empty" pages={second.pages} />,)
		expect(host.textContent,).toContain('Old one',)
		expect(second.pending(),).toBe(1,)

		// A late result from the old iterator must not land in the new one's pages.
		await first.resolve('Old two',)
		expect(host.textContent,).not.toContain('Old two',)

		await second.resolve('New one',)
		expect(host.textContent,).toContain('New one',)
		expect(buttonLabels(host,),).toEqual(['1', 'load more...',],)
	})
})
