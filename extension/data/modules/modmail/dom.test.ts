/** Tests for formatRecentModmailTimestamp. */

import type {ReactElement,} from 'react'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const feedback = vi.hoisted(() => ({
	negativeTextFeedback: vi.fn(),
	positiveTextFeedback: vi.fn(),
}))
const uiLocations = vi.hoisted(() => ({
	provideLocation: vi.fn(() => () => {}),
	renderAtLocation: vi.fn(
		(
			_location: string,
			_opts: {id: string},
			fn: (args: {context: unknown; target: Element},) => ReactElement | null,
		) => {
			uiLocations.lastRenderFn = fn
			return () => {}
		},
	),
	lastRenderFn: null as ((args: {context: unknown; target: Element},) => ReactElement | null) | null,
}))

vi.mock('../../store/feedback', () => feedback,)
vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)
vi.mock('../macros/components/MacroSelect', () => ({
	MacroSelect: () => null,
}),)
vi.mock('../../dom/uiLocations', () => ({
	provideLocation: uiLocations.provideLocation,
	renderAtLocation: uiLocations.renderAtLocation,
}),)

import {createModmailHandlers, formatRecentModmailTimestamp,} from './dom'
import type {ModmailSettings,} from './settings'

const defaultSettings: ModmailSettings = {
	previewByDefault: false,
	searchAtTop: false,
	showRecentMessageTime: true,
	hideUserSidebarProfileIcon: false,
	usernameProfileWhenSidebarOpen: false,
}

/**
 * Builds a modmail username opener (`mod-notes-opener[trigger-source="modmail-username"]`)
 * wrapping a profile anchor, mirroring how Reddit renders the participant username.
 */
function makeUsernameOpener (author = 'foo',) {
	const opener = document.createElement('mod-notes-opener',)
	opener.setAttribute('trigger-source', 'modmail-username',)
	opener.setAttribute('user-name', author,)
	const anchor = document.createElement('a',)
	anchor.href = '#'
	anchor.textContent = `u/${author}`
	opener.appendChild(anchor,)
	document.body.appendChild(opener,)
	return {opener, anchor,}
}

/** Adds/removes a `mod-notes-rail-closer` to represent the user info sidebar open state. */
function setSidebarState (state: 'open' | 'closed' | 'absent',) {
	document.querySelector('mod-notes-rail-closer',)?.remove()
	if (state === 'absent') { return }
	const closer = document.createElement('mod-notes-rail-closer',)
	if (state === 'closed') { closer.classList.add('hidden',) }
	document.body.appendChild(closer,)
}

function setPath (path: string,) {
	window.history.pushState({}, '', path,)
}

function makeModmailWrapper ({
	subreddit = 'testsub',
	author = 'testuser',
	withSavedResponses = true,
	withComposer = true,
} = {},) {
	const wrapper = document.createElement('modmail-thread-wrapper',)

	if (withSavedResponses) {
		const savedResponses = document.createElement('rpl-dropdown',)
		savedResponses.id = 'modmail-saved-responses-dropdown'
		wrapper.appendChild(savedResponses,)

		const savedResponsesSettings = document.createElement('a',)
		savedResponsesSettings.href = `/mod/${subreddit}/saved-responses/`
		wrapper.appendChild(savedResponsesSettings,)
	}

	if (withComposer) {
		const composer = document.createElement('shreddit-composer',)
		const shadow = composer.attachShadow({mode: 'open',},)
		const textarea = document.createElement('textarea',)
		shadow.appendChild(textarea,)
		wrapper.appendChild(composer,)
	}

	const opener = document.createElement('mod-notes-opener',)
	opener.setAttribute('user-name', author,)
	opener.setAttribute('subreddit-name', subreddit,)
	wrapper.appendChild(opener,)

	document.body.appendChild(wrapper,)
	return wrapper
}

afterEach(() => {
	document.body.innerHTML = ''
	uiLocations.lastRenderFn = null
	vi.clearAllMocks()
	setPath('/',)
},)

describe('formatRecentModmailTimestamp', () => {
	it('formats timestamps less than 24 hours old', () => {
		const text = formatRecentModmailTimestamp(
			new Date('2026-05-24T07:59:32.326Z',),
			new Date('2026-05-24T12:00:00.000Z',),
		)

		expect(text,).toContain('May',)
		expect(text,).toContain('24',)
		expect(text,).toContain('7:59',)
	})

	it('does not format timestamps 24 hours old or older', () => {
		expect(formatRecentModmailTimestamp(
			new Date('2026-05-24T07:59:32.326Z',),
			new Date('2026-05-25T07:59:32.326Z',),
		),).toBeNull()
	})

	it('does not format future or invalid timestamps', () => {
		expect(formatRecentModmailTimestamp(
			new Date('2026-05-25T07:59:32.326Z',),
			new Date('2026-05-24T07:59:32.326Z',),
		),).toBeNull()
		expect(formatRecentModmailTimestamp(new Date('not a date',),),).toBeNull()
	})
})

describe('createModmailHandlers', () => {
	beforeEach(() => {
		setPath('/mail/all/abc123',)
	},)

	it('updates recent modmail time elements when enabled', () => {
		const time = document.createElement('time',)
		time.dateTime = '2026-05-24T07:59:32.326Z'
		time.textContent = 'May 24'
		document.body.appendChild(time,)
		vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z',),)

		createModmailHandlers(defaultSettings,).scan(document.body,)

		expect(time.textContent,).toContain('7:59',)
		expect(time.dataset.toolboxOriginalText,).toBe('May 24',)
		vi.useRealTimers()
	})

	it('leaves recent modmail time elements alone when disabled', () => {
		const time = document.createElement('time',)
		time.dateTime = '2026-05-24T07:59:32.326Z'
		time.textContent = 'May 24'
		document.body.appendChild(time,)
		vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z',),)

		createModmailHandlers({...defaultSettings, showRecentMessageTime: false,},).scan(document.body,)

		expect(time.textContent,).toBe('May 24',)
		expect(time.dataset.toolboxOriginalText,).toBeUndefined()
		vi.useRealTimers()
	})

	it('mounts a modmail macro selector immediately after saved responses', () => {
		const wrapper = makeModmailWrapper()

		createModmailHandlers(defaultSettings,).scan(document.body,)

		const macroHost = wrapper.querySelector('.toolbox-modmail-macro-select',)
		const savedResponses = wrapper.querySelector('#modmail-saved-responses-dropdown',)
		expect(macroHost,).not.toBeNull()
		expect(savedResponses?.nextElementSibling,).toBe(macroHost,)

		// Verify props passed to MacroSelect via the renderAtLocation callback
		const element = uiLocations.lastRenderFn?.({context: {subreddit: 'testsub',}, target: macroHost!,},)
		expect(element?.props.subreddit,).toBe('testsub',)
		expect(element?.props.type,).toBe('modmail',)
		expect(element?.props.presentation,).toBe('button',)
		expect(element?.props.label,).toBe('Mod macros',)
	})

	it('does not mount duplicate macro selectors on repeated scans', () => {
		const wrapper = makeModmailWrapper()
		const handlers = createModmailHandlers(defaultSettings,)

		handlers.scan(document.body,)
		handlers.scan(document.body,)

		expect(wrapper.querySelectorAll('.toolbox-modmail-macro-select',),).toHaveLength(1,)
	})

	it('tears down the previous thread macro selector when a new thread wrapper appears', () => {
		// Modmail is an SPA: opening a new thread mounts a fresh wrapper while Reddit may
		// leave the previous one attached. Only the newest (active) wrapper should keep a button.
		const firstWrapper = makeModmailWrapper()
		const handlers = createModmailHandlers(defaultSettings,)
		handlers.scan(document.body,)

		const secondWrapper = makeModmailWrapper()
		handlers.scan(document.body,)

		const hosts = document.querySelectorAll('.toolbox-modmail-macro-select',)
		expect(hosts,).toHaveLength(1,)
		expect(secondWrapper.contains(hosts[0],),).toBe(true,)
		expect(firstWrapper.querySelector('.toolbox-modmail-macro-select',),).toBeNull()
	})

	it('releases a tracked macro selector when its thread wrapper is removed', () => {
		const wrapper = makeModmailWrapper()
		const handlers = createModmailHandlers(defaultSettings,)
		handlers.scan(document.body,)
		expect(document.querySelector('.toolbox-modmail-macro-select',),).not.toBeNull()

		wrapper.remove()
		handlers.handleMutations([
			{addedNodes: [] as unknown as NodeList, removedNodes: [wrapper,] as unknown as NodeList,} as MutationRecord,
		],)

		expect(document.querySelector('.toolbox-modmail-macro-select',),).toBeNull()
	})

	it('inserts selected macro text into the modmail composer', async () => {
		const wrapper = makeModmailWrapper()
		createModmailHandlers(defaultSettings,).scan(document.body,)
		const textarea = wrapper.querySelector('shreddit-composer',)!.shadowRoot!.querySelector('textarea',)!
		textarea.value = 'Existing '
		textarea.setSelectionRange(textarea.value.length, textarea.value.length,)
		const reset = vi.fn()

		// Get onSelectMacro from the renderAtLocation callback
		const element = uiLocations.lastRenderFn?.({
			context: {subreddit: 'testsub',},
			target: wrapper.querySelector('.toolbox-modmail-macro-select',)!,
		},)
		await element?.props.onSelectMacro(
			{text: 'hello {author} in {subreddit}',},
			document.createElement('div',),
			reset,
		)

		expect(textarea.value,).toBe('Existing hello testuser in testsub',)
		expect(reset,).toHaveBeenCalledOnce()
		expect(feedback.positiveTextFeedback,).toHaveBeenCalledWith('Inserted modmail macro',)
	})

	it('reports a failure when a selected macro cannot find the composer', async () => {
		makeModmailWrapper({withComposer: false,},)
		createModmailHandlers(defaultSettings,).scan(document.body,)
		const reset = vi.fn()

		// Get onSelectMacro from the renderAtLocation callback
		const element = uiLocations.lastRenderFn?.({
			context: {subreddit: 'testsub',},
			target: document.body,
		},)
		await element?.props.onSelectMacro(
			{text: 'hello',},
			document.createElement('div',),
			reset,
		)

		expect(feedback.negativeTextFeedback,).toHaveBeenCalledWith('Could not find modmail composer',)
		expect(reset,).toHaveBeenCalledOnce()
	})

	it('moves the search form to the top when enabled', () => {
		const container = document.createElement('div',)
		const redditSearch = document.createElement('reddit-search-large',)
		const searchForm = document.createElement('form',)
		searchForm.id = 'modmail-search-form'
		searchForm.className = 'hidden mt-md'
		container.append(redditSearch, searchForm,)
		document.body.appendChild(container,)

		createModmailHandlers({...defaultSettings, searchAtTop: true,},).scan(document.body,)

		expect(document.body.classList.contains('toolbox-modmail-search-top',),).toBe(true,)
		expect(searchForm.classList.contains('hidden',),).toBe(false,)
		expect(searchForm.classList.contains('mt-md',),).toBe(false,)
		expect(container.firstElementChild,).toBe(searchForm,)
	})

	describe('username opens profile when sidebar is open', () => {
		// The interceptor is a document-level capture listener, which afterEach's innerHTML reset
		// does not remove. Track every handler bundle and tear it down so listeners never leak
		// into the next test. cleanup() drives an async lifecycle, so flush a macrotask after.
		const created: Array<{cleanup: () => void}> = []

		function makeHandlers (usernameProfileWhenSidebarOpen: boolean,) {
			const handlers = createModmailHandlers({...defaultSettings, usernameProfileWhenSidebarOpen,},)
			created.push(handlers,)
			return handlers
		}

		afterEach(async () => {
			for (const handlers of created.splice(0,)) { handlers.cleanup() }
			await new Promise((resolve,) => setTimeout(resolve, 0,))
		},)

		// Simulates Reddit's mod-notes-opener click handler (opens the sidebar, cancels
		// navigation). Returns a spy that records whether that handler ran for this click.
		function attachRedditHandler (opener: Element,) {
			const redditHandler = vi.fn((event: Event,) => event.preventDefault())
			opener.addEventListener('click', redditHandler,)
			return redditHandler
		}

		it('stops Reddit from hijacking the click when the sidebar is open', () => {
			const {opener, anchor,} = makeUsernameOpener()
			setSidebarState('open',)
			const redditHandler = attachRedditHandler(opener,)
			makeHandlers(true,)

			const notCancelled = anchor.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true,},),)

			// Reddit's handler is blocked and the default anchor navigation is left intact.
			expect(redditHandler,).not.toHaveBeenCalled()
			expect(notCancelled,).toBe(true,)
		})

		it('lets Reddit handle the click when the sidebar is closed', () => {
			const {opener, anchor,} = makeUsernameOpener()
			setSidebarState('closed',)
			const redditHandler = attachRedditHandler(opener,)
			makeHandlers(true,)

			anchor.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true,},),)

			expect(redditHandler,).toHaveBeenCalledOnce()
		})

		it('lets Reddit handle the click when the sidebar is absent', () => {
			const {opener, anchor,} = makeUsernameOpener()
			setSidebarState('absent',)
			const redditHandler = attachRedditHandler(opener,)
			makeHandlers(true,)

			anchor.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true,},),)

			expect(redditHandler,).toHaveBeenCalledOnce()
		})

		it('does not intercept clicks when the option is disabled', () => {
			const {opener, anchor,} = makeUsernameOpener()
			setSidebarState('open',)
			const redditHandler = attachRedditHandler(opener,)
			makeHandlers(false,)

			anchor.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true,},),)

			expect(redditHandler,).toHaveBeenCalledOnce()
		})

		it('stops intercepting after cleanup', async () => {
			const {opener, anchor,} = makeUsernameOpener()
			setSidebarState('open',)
			const redditHandler = attachRedditHandler(opener,)
			const handlers = makeHandlers(true,)

			handlers.cleanup()
			// cleanup() runs its registered teardowns through an async lifecycle; let them flush.
			await new Promise((resolve,) => setTimeout(resolve, 0,))

			anchor.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true,},),)

			expect(redditHandler,).toHaveBeenCalledOnce()
		})
	})
})
