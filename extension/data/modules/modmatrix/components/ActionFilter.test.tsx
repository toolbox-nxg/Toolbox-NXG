/** Tests for the Mod Log Matrix action filter tree's expand-all behavior. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

import type {ActionInfo,} from '../schema'
import {ActionFilter,} from './ActionFilter'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
},)

const action = (title: string,): ActionInfo => ({title, className: '',})

// Actions in two different subgroups of one group, and one in no known group ("Other").
const subredditActions = {
	banuser: action('ban user',),
	addmoderator: action('add moderator',),
	somethingnew: action('something new',),
}

async function renderFilter () {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	await act(async () => {
		root.render(<ActionFilter subredditActions={subredditActions} actionFilter={null} onChange={vi.fn()} />,)
	},)
	return host
}

const click = async (element: Element,) => {
	await act(async () => element.dispatchEvent(new MouseEvent('click', {bubbles: true,},),))
}

const buttonByText = (host: HTMLElement, text: string,) =>
	[...host.querySelectorAll('button',),].find((b,) => b.textContent === text)!

/** Ids of the per-action checkboxes currently rendered. */
const visibleActionIds = (host: HTMLElement,) =>
	[...host.querySelectorAll<HTMLInputElement>('input[id^="mm-actionfilter-"]',),]
		.map((i,) => i.id)
		.filter((id,) => !/^mm-actionfilter-(all|group-|subreddit-)/.test(id,))
		.sort()

describe('ActionFilter Show/Hide All expander', () => {
	it('opens every group and subgroup at once, and closes the tree again', async () => {
		const host = await renderFilter()
		expect(visibleActionIds(host,),).toEqual([],)

		await click(buttonByText(host, 'Show/Hide All',),)
		expect(visibleActionIds(host,),).toEqual(
			['mm-actionfilter-addmoderator', 'mm-actionfilter-banuser', 'mm-actionfilter-somethingnew',],
		)

		await click(buttonByText(host, 'Show/Hide All',),)
		expect(visibleActionIds(host,),).toEqual([],)
	})

	it('still lets a single group be collapsed after expanding all', async () => {
		const host = await renderFilter()
		await click(buttonByText(host, 'Show/Hide All',),)

		await click(buttonByText(host, 'Other',),)
		expect(visibleActionIds(host,),).toEqual(['mm-actionfilter-addmoderator', 'mm-actionfilter-banuser',],)
	})
})
