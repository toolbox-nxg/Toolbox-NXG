/** Tests for ModButtonPopup's action selection: auto-selection, fallback, and action-scoped state. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {
		runtime: {sendMessage: vi.fn(), getURL: vi.fn((path: string,) => path),},
		storage: {local: {get: vi.fn().mockResolvedValue({},),},},
	},
}),)
vi.mock('../../../api/resources/me', () => ({getCurrentUser: vi.fn(async () => 'me'),}),)
vi.mock('../../../api/resources/modSubs', () => ({getModSubs: vi.fn(),}),)
vi.mock('../../../store', () => ({default: {dispatch: vi.fn(),},}),)
vi.mock('../../../store/feedback', () => ({
	negativeTextFeedback: vi.fn(),
	neutralTextFeedback: vi.fn(),
	positiveTextFeedback: vi.fn(),
}),)
vi.mock('../../../shared/window/Window', () => ({
	Window: ({children, footer,}: {children: React.ReactNode; footer: React.ReactNode},) => (
		<div>
			{children}
			<footer>{footer}</footer>
		</div>
	),
}),)
vi.mock('../../shared/modnotes/ModNotesPager', () => ({ModNotesPager: () => <div>user modlog</div>,}),)
vi.mock('./ModButtonPopup.helpers', async (importOriginal,) => ({
	...await importOriginal<typeof import('./ModButtonPopup.helpers')>(),
	fetchSubStatus: vi.fn(),
}),)

import {getModSubs,} from '../../../api/resources/modSubs'
import type {ThingInfo,} from '../../../util/reddit/thingInfo'
import type {ModButtonActions, SubStatus,} from '../schema'
import {fetchSubStatus,} from './ModButtonPopup.helpers'

import {ModButtonPopup,} from './ModButtonPopup'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

beforeEach(() => {
	vi.mocked(getModSubs,).mockReturnValue(Promise.resolve(['sub1', 'sub2',],),)
	// Subreddit status stays loading unless a test resolves it.
	vi.mocked(fetchSubStatus,).mockReturnValue(new Promise(() => {},),)
},)

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
	vi.clearAllMocks()
},)

const loadedStatus = (overrides: Partial<SubStatus>,): SubStatus => ({
	loading: false,
	banned: false,
	daysLeft: null,
	isMod: false,
	isContributor: false,
	isMuted: false,
	currentUserPermissions: ['all',],
	...overrides,
})

const actions = {
	getBanMacros: vi.fn(async () => null),
	getSavedBanMacros: vi.fn(async () => []),
	getRequireBanMessage: vi.fn(async () => false),
} as unknown as ModButtonActions

async function renderPopup (
	{lastAction = 'ban', subreddit = 'sub1',}: {lastAction?: string; subreddit?: string} = {},
) {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	await act(async () => {
		root.render(
			<ModButtonPopup
				info={{subreddit, user: 'target', author: 'target', fullname: 't3_abc',} as ThingInfo}
				initialPosition={{top: 0, left: 0,}}
				rememberLastAction
				globalButton
				excludeGlobal={[]}
				savedSubs={[]}
				onSavedSubsChange={vi.fn()}
				lastAction={lastAction}
				setLastAction={vi.fn()}
				onClose={vi.fn()}
				actions={actions}
			/>,
		)
	},)
	return host
}

/** The footer's action menu. */
const actionMenu = (host: HTMLElement,) => host.querySelector('footer select',) as HTMLSelectElement

const changeAction = async (host: HTMLElement, value: string,) => {
	const menu = actionMenu(host,)
	await act(async () => {
		menu.value = value
		menu.dispatchEvent(new Event('change', {bubbles: true,},),)
	},)
}

const click = async (element: Element,) => {
	await act(async () => element.dispatchEvent(new MouseEvent('click', {bubbles: true,},),))
}

const buttonByText = (host: HTMLElement, text: string,) =>
	[...host.querySelectorAll('button',),].find((b,) => b.textContent === text)!

describe('ModButtonPopup action selection', () => {
	it('pre-selects the action that fits the target\'s status once it loads', async () => {
		vi.mocked(fetchSubStatus,).mockResolvedValue({status: loadedStatus({isMod: true,},), banInfo: null,},)
		const host = await renderPopup()
		expect(actionMenu(host,).value,).toBe('demod',)
	})

	it('falls back to the first available action when the remembered one does not apply', async () => {
		// Access but no mail permission: no suggestion, and mute is unavailable.
		vi.mocked(fetchSubStatus,).mockResolvedValue({
			status: loadedStatus({currentUserPermissions: ['access',],},),
			banInfo: null,
		},)
		const host = await renderPopup({lastAction: 'mute',},)
		expect(actionMenu(host,).value,).toBe('ban',)
		expect([...actionMenu(host,).options,].map((o,) => o.value),).toEqual(['ban', 'mod', 'add submitter',],)
	})

	it('drops a pending confirmation and global mode when the status load changes the action', async () => {
		// The menu is hidden while a confirmation is pending, so the action can only change under it
		// by auto-selection or fallback - here, the status arriving shows the target is a mod.
		let resolveStatus: (value: Awaited<ReturnType<typeof fetchSubStatus>>,) => void = () => {}
		vi.mocked(fetchSubStatus,).mockReturnValue(
			new Promise((resolve,) => {
				resolveStatus = resolve
			},),
		)
		const host = await renderPopup({lastAction: 'mod',},)
		const globalToggle = host.querySelector('input[type="checkbox"]',) as HTMLInputElement
		await click(globalToggle,)
		expect(globalToggle.checked,).toBe(true,)

		await click(buttonByText(host, 'Save',),)
		expect(host.querySelector('footer',)!.textContent,).toContain('This will mod /u/target',)

		await act(async () => resolveStatus({status: loadedStatus({isMod: true,},), banInfo: null,},))
		// The footer swapped back from the confirmation to the action menu, under the new action.
		expect(actionMenu(host,).value,).toBe('demod',)
		expect(host.querySelector('footer',)!.textContent,).not.toContain('This will mod',)
		expect((host.querySelector('input[type="checkbox"]',) as HTMLInputElement).checked,).toBe(false,)
	})

	it('clears the status message when another action is picked', async () => {
		const host = await renderPopup({lastAction: 'mod',},)
		// Uncheck the context subreddit so Save reports that nothing is selected.
		const subCheckbox = [...host.querySelectorAll('input[type="checkbox"]',),].at(1,) as HTMLInputElement
		await click(subCheckbox,)
		await click(buttonByText(host, 'Save',),)
		expect(host.querySelector('footer',)!.textContent,).toContain('error, no subreddits selected',)

		await changeAction(host, 'add submitter',)
		expect(host.querySelector('footer',)!.textContent,).not.toContain('no subreddits selected',)
	})

	it('sends modmail from a moderated subreddit when the context one is not', async () => {
		const host = await renderPopup({subreddit: 'elsewhere',},)
		await click([...host.querySelectorAll('[role="tab"]',),].find((t,) => t.textContent === 'Send Modmail')!,)
		const fromMenu = [...host.querySelectorAll('select',),].find((s,) =>
			[...s.options,].some((o,) => o.value === 'sub2')
		)!
		expect(fromMenu.value,).toBe('sub1',)
	})
})
