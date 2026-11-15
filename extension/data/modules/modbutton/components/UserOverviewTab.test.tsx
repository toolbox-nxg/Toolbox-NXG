/** Tests for UserOverviewTab's account and flair loads, including deleted or hidden accounts. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const logError = vi.hoisted(() => vi.fn())

vi.mock('webextension-polyfill', () => ({
	default: {
		runtime: {sendMessage: vi.fn(), getURL: vi.fn((path: string,) => path),},
		storage: {local: {get: vi.fn().mockResolvedValue({},),},},
	},
}),)
vi.mock('../../../util/infra/logging', () => ({
	default: () => ({error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn(),}),
}),)
vi.mock('../../../api/resources/users', async (importOriginal,) => ({
	...await importOriginal<typeof import('../../../api/resources/users')>(),
	aboutUser: vi.fn(),
}),)
vi.mock('../../../api/resources/flair', () => ({getFlairSelector: vi.fn(),}),)
vi.mock('../../../api/resources/modnotes', () => ({
	getAllModNotes: vi.fn(async function* () {},),
}),)
vi.mock('../../../api/resources/things', () => ({getInfoBulk: vi.fn(async () => []),}),)
vi.mock('../../../shared/controls/Timestamp', () => ({Timestamp: () => <span>a while ago</span>,}),)

import {getFlairSelector,} from '../../../api/resources/flair'
import {aboutUser, type UserAbout,} from '../../../api/resources/users'
import {UserOverviewTab,} from './UserOverviewTab'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

/** An Error carrying a response with the given status, as the transport throws for non-OK replies. */
const failedWith = (status: number,) =>
	Object.assign(new Error(`HTTP ${status}`,), {response: new Response(null, {status,},),},)

const foundAccount = {
	kind: 't2',
	data: {name: 'target', created_utc: 1_600_000_000, is_suspended: false,},
} as UserAbout

beforeEach(() => {
	vi.mocked(getFlairSelector,).mockResolvedValue({
		current: {flair_text: 'Regular', flair_css_class: '', flair_template_id: null,},
		choices: [],
	},)
},)

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
	vi.clearAllMocks()
},)

async function renderTab () {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	await act(async () => {
		root.render(
			<UserOverviewTab
				user="target"
				defaultSub="sub1"
				modSubs={['sub1', 'sub2',]}
				subStatuses={new Map()}
				onSubredditSelect={vi.fn()}
			/>,
		)
	},)
	return host
}

const flairRow = (host: HTMLElement,) =>
	[...host.querySelectorAll('p',),].find((p,) => p.textContent?.startsWith('Flair:',))?.textContent

describe('UserOverviewTab account and flair', () => {
	it('shows a found account and its flair in the selected subreddit', async () => {
		vi.mocked(aboutUser,).mockResolvedValue(foundAccount,)
		const host = await renderTab()

		expect(host.textContent,).toContain('/u/target- Account created a while ago',)
		expect(flairRow(host,),).toBe('Flair:Regular',)
		expect(getFlairSelector,).toHaveBeenCalledWith('sub1', 'target',)
	})

	it('treats a 404 as a missing account: no flair request, and nothing logged', async () => {
		vi.mocked(aboutUser,).mockRejectedValue(failedWith(404,),)
		const host = await renderTab()

		expect(host.textContent,).toContain('/u/target was not found: the account is deleted, or hidden by Reddit.',)
		expect(flairRow(host,),).toBe('Flair:Unavailable',)
		// flairselector would answer with the requesting mod's own flair for a missing account.
		expect(getFlairSelector,).not.toHaveBeenCalled()
		expect(logError,).not.toHaveBeenCalled()
	})

	it('shows and logs any other account failure, without requesting flair', async () => {
		vi.mocked(aboutUser,).mockRejectedValue(failedWith(500,),)
		const host = await renderTab()

		expect(host.textContent,).toContain('HTTP 500',)
		expect(flairRow(host,),).toBe('Flair:Unavailable',)
		expect(getFlairSelector,).not.toHaveBeenCalled()
		expect(logError,).toHaveBeenCalledWith('Failed to load account info:', expect.any(Error,),)
	})
})
