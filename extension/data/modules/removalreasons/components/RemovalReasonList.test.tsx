/** Tests for RemovalReasonList, focused on how the reason form persists the post/comment applicability flags. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const getLinkFlairTemplates = vi.hoisted(() => vi.fn())
const getSubredditColors = vi.hoisted(() => vi.fn())
const reloadConfigFromWiki = vi.hoisted(() => vi.fn())

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)

vi.mock('../../../api/resources/flair', () => ({
	getLinkFlairTemplates,
}),)

vi.mock('../../config/moduleapi', () => ({
	reloadConfigFromWiki,
}),)

vi.mock('../../shared/usernotes/moduleapi', () => ({
	getSubredditColors,
}),)

vi.mock('../../shared/removalReasons/parser', () => ({
	getRemovalReasonParser: () => ({
		render: (markdown: string,) => `<p>${markdown}</p>`,
	}),
}),)

vi.mock('@dnd-kit/core', async () => {
	const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core',)
	return {
		...actual,
		DndContext: ({children,}: any,) => children,
	}
},)

vi.mock('@dnd-kit/sortable', async () => {
	const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable',)
	return {
		...actual,
		SortableContext: ({children,}: any,) => children,
		useSortable: () => ({
			attributes: {},
			listeners: {},
			setNodeRef: vi.fn(),
			setActivatorNodeRef: vi.fn(),
			transform: null,
			transition: undefined,
			isDragging: false,
		}),
	}
},)

import type {ConfigState,} from '../../../util/wiki/schemas/config/schema'
import {RemovalReasonList,} from './RemovalReasonList'

let container: HTMLDivElement
let root: Root
let onSave: ReturnType<typeof vi.fn>

/** Builds a fresh ConfigState holding the given removal reasons. */
function makeState (reasons: Array<Record<string, unknown>>,): ConfigState {
	return {
		config: {removalReasons: {reasons,},},
		subreddit: 'testsub',
		postFlairTemplates: [],
		userFlairTemplates: null,
	}
}

/** Renders the list with an addRef so tests can open the add-reason form. */
function renderList (state: ConfigState,) {
	const addRef = {current: null as (() => void) | null,}
	act(() => {
		root.render(<RemovalReasonList state={state} addRef={addRef} onSave={onSave} />,)
	},)
	return addRef
}

/** Finds the checkbox whose wrapping label contains the given text. */
function getCheckbox (labelText: string,) {
	const label = [...container.querySelectorAll('label',),]
		.find((el,) => el.textContent?.includes(labelText,))
	const checkbox = label?.querySelector<HTMLInputElement>('input[type="checkbox"]',)
	expect(checkbox,).toBeTruthy()
	return checkbox!
}

/** Finds a button by its trimmed text content. */
function getButton (text: string,) {
	const button = [...container.querySelectorAll('button',),]
		.find((el,) => el.textContent?.trim() === text)
	expect(button,).toBeTruthy()
	return button!
}

beforeEach(() => {
	;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
	container = document.createElement('div',)
	document.body.appendChild(container,)
	root = createRoot(container,)
	onSave = vi.fn()
	getLinkFlairTemplates.mockResolvedValue([],)
	getSubredditColors.mockResolvedValue([],)
	reloadConfigFromWiki.mockResolvedValue(null,)
},)

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	document.body.classList.remove('toolbox-wiki-edited',)
	vi.clearAllMocks()
},)

describe('RemovalReasonList reason form flags', () => {
	it('omits removeComments when a new reason is saved with Comments unchecked', async () => {
		const state = makeState([],)
		const addRef = renderList(state,)
		await act(async () => addRef.current!())

		act(() => {
			getButton('Save new reason',).click()
		},)

		expect(onSave,).toHaveBeenCalledOnce()
		const saved = state.config.removalReasons.reasons[0]
		expect(saved.removePosts,).toBe(true,)
		// An absent flag defers to the per-mod "enable removal reasons for
		// comments" setting; an explicit false would override that setting.
		expect('removeComments' in saved,).toBe(false,)
	})

	it('writes removeComments: true when a new reason is saved with Comments checked', async () => {
		const state = makeState([],)
		const addRef = renderList(state,)
		await act(async () => addRef.current!())

		act(() => {
			getCheckbox('Comments',).click()
		},)
		act(() => {
			getButton('Save new reason',).click()
		},)

		expect(state.config.removalReasons.reasons[0]!.removeComments,).toBe(true,)
	})

	it('still writes removePosts: false when Posts is unchecked', async () => {
		const state = makeState([],)
		const addRef = renderList(state,)
		await act(async () => addRef.current!())

		act(() => {
			getCheckbox('Posts',).click()
		},)
		act(() => {
			getButton('Save new reason',).click()
		},)

		expect(state.config.removalReasons.reasons[0]!.removePosts,).toBe(false,)
	})

	it('heals an explicit removeComments: false on edit when the box stays unchecked', async () => {
		const state = makeState([{
			id: 'abcd1234',
			text: 'Rule reason',
			title: 'A reason',
			removePosts: true,
			removeComments: false,
			flairText: '',
			flairCSS: '',
			flairTemplateID: '',
		},],)
		renderList(state,)

		const editButton = container.querySelector<HTMLButtonElement>('button[title="Edit"]',)
		expect(editButton,).toBeTruthy()
		await act(async () => editButton!.click())

		act(() => {
			getButton('Save reason',).click()
		},)

		expect(onSave,).toHaveBeenCalledOnce()
		const saved = state.config.removalReasons.reasons[0]
		expect(saved.id,).toBe('abcd1234',)
		expect('removeComments' in saved,).toBe(false,)
	})

	it('keeps removeComments: true across an edit when the box stays checked', async () => {
		const state = makeState([{
			id: 'abcd1234',
			text: 'Rule reason',
			title: 'A reason',
			removePosts: true,
			removeComments: true,
			flairText: '',
			flairCSS: '',
			flairTemplateID: '',
		},],)
		renderList(state,)

		const editButton = container.querySelector<HTMLButtonElement>('button[title="Edit"]',)
		expect(editButton,).toBeTruthy()
		await act(async () => editButton!.click())

		act(() => {
			getButton('Save reason',).click()
		},)

		expect(state.config.removalReasons.reasons[0]!.removeComments,).toBe(true,)
	})
})
