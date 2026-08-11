/** Tests for QueueItemTables: when the recent-actions table starts expanded rather than collapsed. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)

import type {UILocationContext,} from '../../../dom/uiLocations'
import {RedditPlatform,} from '../../../util/infra/platform'
import {QueueItemTables,} from './QueueItemTables'

let container: HTMLElement
let root: Root

beforeEach(() => {
	container = document.createElement('div',)
	document.body.append(container,)
	root = createRoot(container,)
},)

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	document.body.className = ''
	document.body.innerHTML = ''
},)

const context: UILocationContext = {
	platform: RedditPlatform.Old,
	kind: 'post',
	author: 'someuser',
	subreddit: 'somesub',
	thingId: 't3_abc',
	isRemoved: false,
}

/**
 * Mounts the component with stub data accessors that resolve to a single mod-log action, so the
 * actions half always has something to show.
 * @param autoExpandActions Value for the page-independent auto-expand setting.
 */
async function mount (autoExpandActions: boolean,) {
	await act(async () => {
		root.render(
			<QueueItemTables
				context={context}
				showRecentActionsOnApproved={true}
				showRecentActionsOnRemoved={true}
				showReportReasons={false}
				autoExpandActions={autoExpandActions}
				getActions={(_subreddit, _fullName, callback,) => {
					callback({
						abc: {id: 'abc', mod: 'somemod', action: 'approvelink', details: '', created_utc: 1000,},
					},)
				}}
				checkIsMod={() => Promise.resolve(true,)}
				getThingData={() => Promise.resolve({},)}
				getReports={() => Promise.resolve(null,)}
			/>,
		)
	},)
}

/** Returns the toggle button's label, or `null` when the actions half didn't render. */
function toggleLabel (): string | null {
	return container.querySelector('button',)?.textContent ?? null
}

describe('QueueItemTables', () => {
	it('starts collapsed when neither auto-expand source applies', async () => {
		await mount(false,)
		expect(toggleLabel(),).toBe('show recent actions',)
		expect(container.querySelector('table',),).toBeNull()
	})

	it('starts expanded when the everywhere setting is on', async () => {
		await mount(true,)
		expect(toggleLabel(),).toBe('hide recent actions',)
		expect(container.querySelector('table',),).not.toBeNull()
	})

	it('starts expanded when the queue-only body class is set', async () => {
		document.body.classList.add('toolbox-show-actions',)
		await mount(false,)
		expect(toggleLabel(),).toBe('hide recent actions',)
	})

	it('can still be collapsed by hand after auto-expanding', async () => {
		await mount(true,)
		act(() => {
			container.querySelector('button',)!.click()
		},)
		expect(toggleLabel(),).toBe('show recent actions',)
		expect(container.querySelector('table',),).toBeNull()
	})
})
