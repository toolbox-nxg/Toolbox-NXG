/** Tests for SubredditNotesPopup. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const getModSubs = vi.hoisted(() => vi.fn())
const getCurrentUser = vi.hoisted(() => vi.fn())
const getWikiPages = vi.hoisted(() => vi.fn())
const postToWiki = vi.hoisted(() => vi.fn())
const readFromWiki = vi.hoisted(() => vi.fn())
const negativeTextFeedback = vi.hoisted(() => vi.fn())
const neutralTextFeedback = vi.hoisted(() => vi.fn())
const positiveTextFeedback = vi.hoisted(() => vi.fn())
const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())
const getWikiWritePaths = vi.hoisted(() => vi.fn())
const getNotePagePrefix = vi.hoisted(() => vi.fn())
const getNoteWritePaths = vi.hoisted(() => vi.fn())
const getWikiRevisions = vi.hoisted(() => vi.fn())
const resolveWikiLayout = vi.hoisted(() => vi.fn())

vi.mock('../../../api/resources/modSubs', () => ({getModSubs,}),)
vi.mock('../../../util/wiki/wikiPaths', () => ({
	getWikiWritePaths,
	getNotePagePrefix,
	getNoteWritePaths,
	resolveWikiLayout,
	compatMirrorEnabled: (layout: {state: string; compatibilityWrites: boolean; nxgMissing?: boolean},) =>
		layout.state === 'nxg' && layout.compatibilityWrites && !layout.nxgMissing,
	OLD_NOTE_PAGE_PREFIX: 'notes/',
	NEW_NOTE_PAGE_PREFIX: 'toolbox-nxg/notes/',
	OLD_WIKI_PATHS: {
		settings: 'toolbox',
		usernotes: 'usernotes',
		notes: 'notes/index',
		userSettings: 'tbsettings',
	},
	NEW_WIKI_PATHS: {
		settings: 'toolbox-nxg',
		usernotes: 'toolbox-nxg/usernotes',
		notes: 'toolbox-nxg/notes',
		userSettings: 'toolbox-nxg/user-settings',
	},
}),)
vi.mock('../../../api/resources/me', () => ({getCurrentUser,}),)
vi.mock('../../../api/resources/wiki', () => ({
	getWikiPages,
	getWikiRevisions,
	postToWiki,
	readFromWiki,
}),)
vi.mock('../../../store/feedback', () => ({
	negativeTextFeedback,
	neutralTextFeedback,
	positiveTextFeedback,
}),)
vi.mock('../../../util/infra/logging', () => ({
	default: () => ({debug: vi.fn(), warn: vi.fn(),}),
}),)
vi.mock('../../../util/persistence/cache', () => ({getCache, setCache,}),)
vi.mock('../../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
	mountPopup: vi.fn(),
}),)
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import {SubredditNotesPopup,} from './SubredditNotesPopup'

const roots: Root[] = []

function renderPopup (props: Partial<React.ComponentProps<typeof SubredditNotesPopup>> = {},) {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)

	act(() => {
		root.render(
			<SubredditNotesPopup
				notewiki="notesub"
				monospace={false}
				defaultToCurrentSub={false}
				onClose={vi.fn()}
				{...props}
			/>,
		)
	},)

	return host
}

function setInputValue (input: HTMLInputElement | HTMLTextAreaElement, value: string,) {
	act(() => {
		const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input,), 'value',)?.set
		valueSetter?.call(input, value,)
		input.dispatchEvent(new InputEvent('input', {bubbles: true, data: value,},),)
	},)
}

async function clickByText (host: HTMLElement, text: string,) {
	const element = Array.from(host.querySelectorAll('button, a',),).find((el,) => el.textContent?.includes(text,))
	expect(element,).toBeDefined()
	await act(async () => {
		element!.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
		await Promise.resolve()
	},)
}

/** An empty v1 index for use in mocks. */
const emptyV1Index = {version: 1, notes: [],}

/** Points the mocked wiki path resolver at the legacy-fallback page layout. */
function mockLegacyLayout () {
	resolveWikiLayout.mockResolvedValue({subreddit: 'notesub', state: 'legacyFallback', compatibilityWrites: false,},)
	getWikiWritePaths.mockResolvedValue(['notes/index',],)
	getNotePagePrefix.mockResolvedValue('notes/',)
	getNoteWritePaths.mockImplementation((slug: string,) => Promise.resolve([`notes/${slug}`,],))
}

/** Points the mocked wiki path resolver at the NXG-only (compat-off) page layout. */
function mockNxgLayout () {
	resolveWikiLayout.mockResolvedValue({subreddit: 'notesub', state: 'nxg', compatibilityWrites: false,},)
	getWikiWritePaths.mockResolvedValue(['toolbox-nxg/notes',],)
	getNotePagePrefix.mockResolvedValue('toolbox-nxg/notes/',)
	getNoteWritePaths.mockImplementation((slug: string,) => Promise.resolve([`toolbox-nxg/notes/${slug}`,],))
}

beforeEach(() => {
	getModSubs.mockResolvedValue(['notesub',],)
	getCurrentUser.mockResolvedValue('testmod',)
	getWikiPages.mockResolvedValue([],)
	postToWiki.mockResolvedValue(undefined,)
	readFromWiki.mockResolvedValue({ok: true, data: emptyV1Index,},)
	getCache.mockResolvedValue(null,)
	setCache.mockResolvedValue(undefined,)
	mockLegacyLayout()
},)

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
	vi.restoreAllMocks()
	vi.clearAllMocks()
},)

describe('SubredditNotesPopup', () => {
	it('bootstraps the index from legacy wiki pages when no valid index exists', async () => {
		readFromWiki.mockResolvedValue({ok: false, reason: 'no_page',},)
		getWikiPages.mockResolvedValue(['notes/alpha-note', 'notes/index', 'notes/beta-note',],)
		const host = renderPopup()

		await vi.waitFor(() => expect(host.textContent,).toContain('Alpha Note',))
		expect(host.textContent,).toContain('Beta Note',)
		expect(postToWiki,).toHaveBeenCalledWith(
			'notesub',
			'notes/index',
			expect.objectContaining({
				version: 1,
				notes: expect.arrayContaining([
					expect.objectContaining({slug: 'alpha-note', title: 'Alpha Note',},),
					expect.objectContaining({slug: 'beta-note', title: 'Beta Note',},),
				],),
			},),
			'toolbox subreddit notes index bootstrap',
			true,
			false,
		)
		// The legacy page stays in the v1 wire shape: no aggregate fields.
		const legacyIndex = postToWiki.mock.calls.find((call,) => call[1] === 'notes/index')![2]
		expect(legacyIndex,).not.toHaveProperty('tags',)
		expect(legacyIndex,).not.toHaveProperty('authors',)
	})

	it('bootstraps the index from NXG wiki pages when the subreddit uses the NXG layout', async () => {
		mockNxgLayout()
		readFromWiki.mockResolvedValue({ok: false, reason: 'no_page',},)
		getWikiPages.mockResolvedValue(
			['toolbox-nxg/notes/alpha-note', 'toolbox-nxg/notes', 'toolbox-nxg/notes/beta-note',],
		)
		const host = renderPopup()

		await vi.waitFor(() => expect(host.textContent,).toContain('Alpha Note',))
		expect(host.textContent,).toContain('Beta Note',)
		expect(postToWiki,).toHaveBeenCalledWith(
			'notesub',
			'toolbox-nxg/notes',
			// The NXG page gets the v2 shape with aggregate fields.
			expect.objectContaining({
				version: 2,
				tags: [],
				authors: [],
				notes: expect.arrayContaining([
					expect.objectContaining({slug: 'alpha-note',},),
					expect.objectContaining({slug: 'beta-note',},),
				],),
			},),
			'toolbox subreddit notes index bootstrap',
			true,
			false,
		)
	})

	it('loads and saves a note body through the NXG paths', async () => {
		mockNxgLayout()
		readFromWiki.mockImplementation((_sub: string, page: string,) => {
			if (page === 'toolbox-nxg/notes') {
				return Promise.resolve({
					ok: true,
					data: {
						version: 1,
						notes: [{
							slug: 'alpha',
							title: 'Alpha',
							createdAt: 1,
							updatedAt: 2,
							archived: false,
							tags: [],
						},],
					},
				},)
			}
			return Promise.resolve({ok: true, data: 'old body',},)
		},)
		const host = renderPopup()

		await vi.waitFor(() => expect(host.textContent,).toContain('Alpha',))
		await clickByText(host, 'Alpha',)
		await vi.waitFor(() => expect(host.textContent,).toContain('toolbox-nxg/notes/alpha',))
		expect(readFromWiki,).toHaveBeenCalledWith('notesub', 'toolbox-nxg/notes/alpha', false,)
		await clickByText(host, 'edit',)
		await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('textarea',)?.value,).toBe('old body',))

		setInputValue(host.querySelector<HTMLTextAreaElement>('textarea',)!, 'new body',)
		await clickByText(host, 'save note',)

		await vi.waitFor(() =>
			expect(postToWiki,).toHaveBeenCalledWith(
				'notesub',
				'toolbox-nxg/notes/alpha',
				'new body',
				'toolbox subreddit note update',
				false,
				false,
			)
		)
	})

	it('fans out note writes to both paths when 6.x compatibility is on', async () => {
		resolveWikiLayout.mockResolvedValue({subreddit: 'notesub', state: 'nxg', compatibilityWrites: true,},)
		getNoteWritePaths.mockImplementation((slug: string,) =>
			Promise.resolve([`toolbox-nxg/notes/${slug}`, `notes/${slug}`,],)
		)
		getWikiWritePaths.mockResolvedValue(['toolbox-nxg/notes', 'notes/index',],)
		readFromWiki.mockImplementation((_sub: string, page: string,) => {
			if (page === 'notes/index') {
				return Promise.resolve({
					ok: true,
					data: {
						version: 1,
						notes: [{
							slug: 'alpha',
							title: 'Alpha',
							createdAt: 1,
							updatedAt: 2,
							archived: false,
							tags: [],
						},],
					},
				},)
			}
			return Promise.resolve({ok: true, data: 'old body',},)
		},)
		const host = renderPopup()

		await vi.waitFor(() => expect(host.textContent,).toContain('Alpha',))
		await clickByText(host, 'Alpha',)
		await vi.waitFor(() => expect(host.textContent,).toContain('notes/alpha',))
		await clickByText(host, 'edit',)
		await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('textarea',)?.value,).toBe('old body',))

		setInputValue(host.querySelector<HTMLTextAreaElement>('textarea',)!, 'new body',)
		await clickByText(host, 'save note',)

		await vi.waitFor(() =>
			expect(postToWiki,).toHaveBeenCalledWith(
				'notesub',
				'notes/alpha',
				'new body',
				'toolbox subreddit note update',
				false,
				false,
			)
		)
		expect(postToWiki,).toHaveBeenCalledWith(
			'notesub',
			'toolbox-nxg/notes/alpha',
			'new body',
			'toolbox subreddit note update',
			false,
			false,
		)
		// The index fan-out is split per schema: v1 to the legacy page, v2 to NXG.
		const legacyIndex = postToWiki.mock.calls.find((call,) => call[1] === 'notes/index')![2]
		expect(legacyIndex.version,).toBe(1,)
		expect(legacyIndex,).not.toHaveProperty('tags',)
		const nxgIndex = postToWiki.mock.calls.find((call,) => call[1] === 'toolbox-nxg/notes')![2]
		expect(nxgIndex,).toMatchObject({version: 2, tags: [], authors: [],},)
	})

	it('creates and saves a new note with index metadata', async () => {
		const host = renderPopup()
		// Wait for the sidebar to be ready (+ New note button appears after loading)
		await vi.waitFor(() => expect(host.textContent,).toContain('+ New note',))

		await clickByText(host, '+ New note',)
		await vi.waitFor(() => expect(host.textContent,).toContain('Unsaved draft',))

		// New drafts open in edit mode - textarea is immediately visible
		expect(host.querySelector('textarea',),).not.toBeNull()

		// Add tags via the TagInput: type each tag and press Enter to commit it as a pill.
		const tagInput = host.querySelector<HTMLInputElement>('input[aria-label="Note tags"]',)!
		for (const tag of ['ops', 'queue',]) {
			setInputValue(tagInput, tag,)
			await act(async () => {
				tagInput.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true,},),)
				await Promise.resolve()
			},)
		}

		await clickByText(host, 'save note',)

		await vi.waitFor(() =>
			expect(postToWiki,).toHaveBeenCalledWith(
				'notesub',
				expect.stringMatching(/^notes\/\d+-testmod$/,),
				'New note',
				'toolbox new subreddit note',
				false,
				false,
			)
		)
		expect(postToWiki,).toHaveBeenCalledWith(
			'notesub',
			'notes/index',
			expect.objectContaining({
				notes: expect.arrayContaining([expect.objectContaining({
					slug: expect.stringMatching(/^\d+-testmod$/,),
					title: 'New note',
					tags: ['ops', 'queue',],
				},),],),
			},),
			'toolbox subreddit notes index update',
			true,
			false,
		)
		expect(host.textContent,).toContain('Saved',)
	})

	it('loads an existing note, tracks unsaved changes, and saves the body', async () => {
		readFromWiki.mockImplementation((_sub: string, page: string,) => {
			if (page === 'notes/index') {
				return Promise.resolve({
					ok: true,
					data: {
						version: 1,
						notes: [{
							slug: 'alpha',
							title: 'Alpha',
							createdAt: 1,
							updatedAt: 2,
							archived: false,
							tags: [],
						},],
					},
				},)
			}
			return Promise.resolve({ok: true, data: 'old body',},)
		},)
		const host = renderPopup()

		await vi.waitFor(() => expect(host.textContent,).toContain('Alpha',))
		await clickByText(host, 'Alpha',)
		// Notes open in preview mode; wait for meta to appear, then click footer "edit" to enter edit mode
		await vi.waitFor(() => expect(host.textContent,).toContain('notes/alpha',))
		await clickByText(host, 'edit',)
		await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('textarea',)?.value,).toBe('old body',))

		setInputValue(host.querySelector<HTMLTextAreaElement>('textarea',)!, 'new body',)
		expect(host.textContent,).toContain('Unsaved changes',)
		await clickByText(host, 'save note',)

		await vi.waitFor(() =>
			expect(postToWiki,).toHaveBeenCalledWith(
				'notesub',
				'notes/alpha',
				'new body',
				'toolbox subreddit note update',
				false,
				false,
			)
		)
		expect(positiveTextFeedback,).toHaveBeenCalledWith('Note saved.',)
	})

	it('renders a markdown preview without leaving edit changes behind', async () => {
		readFromWiki.mockImplementation((_sub: string, page: string,) => {
			if (page === 'notes/index') {
				return Promise.resolve({
					ok: true,
					data: {
						version: 1,
						notes: [{
							slug: 'alpha',
							title: 'Alpha',
							createdAt: 1,
							updatedAt: 2,
							archived: false,
							tags: [],
						},],
					},
				},)
			}
			return Promise.resolve({ok: true, data: '**bold**',},)
		},)
		const host = renderPopup()

		await vi.waitFor(() => expect(host.textContent,).toContain('Alpha',))
		await clickByText(host, 'Alpha',)
		// Notes open in preview mode by default - markdown pane is shown immediately
		await vi.waitFor(() => expect(host.querySelector('.md',),).not.toBeNull())

		expect(host.querySelector('textarea',),).toBeNull()
		expect(host.querySelector('.md',)?.innerHTML,).toContain('bold',)
	})

	it('archives notes through index metadata instead of hiding wiki pages', async () => {
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {
				version: 1,
				notes: [{slug: 'alpha', title: 'Alpha', createdAt: 1, updatedAt: 2, archived: false, tags: [],},],
			},
		},)
		const host = renderPopup()

		await vi.waitFor(() => expect(host.textContent,).toContain('Alpha',))
		const archiveButton = host.querySelector<HTMLButtonElement>('button[title="Archive note"]',)!
		await act(async () => {
			archiveButton.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
			await Promise.resolve()
		},)

		await vi.waitFor(() =>
			expect(postToWiki,).toHaveBeenCalledWith(
				'notesub',
				'notes/index',
				expect.objectContaining({
					notes: [expect.objectContaining({slug: 'alpha', archived: true,},),],
				},),
				'toolbox subreddit note archive',
				true,
				false,
			)
		)
	})

	it('confirms before closing with unsaved changes', async () => {
		readFromWiki.mockImplementation((_sub: string, page: string,) => {
			if (page === 'notes/index') {
				return Promise.resolve({
					ok: true,
					data: {
						version: 1,
						notes: [{
							slug: 'alpha',
							title: 'Alpha',
							createdAt: 1,
							updatedAt: 2,
							archived: false,
							tags: [],
						},],
					},
				},)
			}
			return Promise.resolve({ok: true, data: 'old body',},)
		},)
		const onClose = vi.fn()
		const confirmSpy = vi.fn().mockReturnValue(false,)
		vi.stubGlobal('confirm', confirmSpy,)
		const host = renderPopup({onClose,},)

		await vi.waitFor(() => expect(host.textContent,).toContain('Alpha',))
		await clickByText(host, 'Alpha',)
		await vi.waitFor(() => expect(host.textContent,).toContain('notes/alpha',))
		await clickByText(host, 'edit',)
		await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('textarea',),).not.toBeNull())
		setInputValue(host.querySelector<HTMLTextAreaElement>('textarea',)!, 'changed body',)

		await act(async () => {
			host.querySelector<HTMLButtonElement>('button[aria-label="Close"]',)!.dispatchEvent(
				new MouseEvent('click', {bubbles: true,},),
			)
			await Promise.resolve()
		},)

		expect(confirmSpy,).toHaveBeenCalledWith('You have unsaved changes. Discard them?',)
		expect(onClose,).not.toHaveBeenCalled()
	})

	it('defaults to current subreddit when defaultToCurrentSub is enabled and user is a mod', async () => {
		getModSubs.mockResolvedValue(['notesub', 'othersub',],)
		readFromWiki.mockResolvedValue({ok: true, data: emptyV1Index,},)
		const host = renderPopup({
			notewiki: 'notesub',
			defaultToCurrentSub: true,
			currentSubreddit: 'othersub',
		},)

		// Overrides the configured notewiki ('notesub') and opens to the current subreddit.
		await vi.waitFor(() => {
			const select = host.querySelector<HTMLSelectElement>('select[aria-label="Switch subreddit notes space"]',)
			expect(select?.value,).toBe('othersub',)
		},)
	})

	it('keeps the configured notewiki when defaultToCurrentSub is off', async () => {
		getModSubs.mockResolvedValue(['notesub', 'othersub',],)
		readFromWiki.mockResolvedValue({ok: true, data: emptyV1Index,},)
		const host = renderPopup({
			notewiki: 'notesub',
			defaultToCurrentSub: false,
			currentSubreddit: 'othersub',
		},)

		await vi.waitFor(() => {
			const select = host.querySelector<HTMLSelectElement>('select[aria-label="Switch subreddit notes space"]',)
			expect(select?.value,).toBe('notesub',)
		},)
	})

	it('falls back to the notewiki when defaultToCurrentSub is on but the user is not a mod of the current sub', async () => {
		getModSubs.mockResolvedValue(['notesub', 'othersub',],)
		readFromWiki.mockResolvedValue({ok: true, data: emptyV1Index,},)
		const host = renderPopup({
			notewiki: 'notesub',
			defaultToCurrentSub: true,
			currentSubreddit: 'somewhereelse',
		},)

		await vi.waitFor(() => {
			const select = host.querySelector<HTMLSelectElement>('select[aria-label="Switch subreddit notes space"]',)
			expect(select?.value,).toBe('notesub',)
		},)
	})
})
