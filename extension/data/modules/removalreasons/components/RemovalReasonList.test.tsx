/** Tests for RemovalReasonList, focused on how the reason form persists the post/comment applicability flags. */

import {act,} from 'react'
import type {ReactNode,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, expectTypeOf, it, vi,} from 'vitest'

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
		DndContext: ({children,}: {children?: ReactNode},) => children,
	}
},)

vi.mock('@dnd-kit/sortable', async () => {
	const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable',)
	return {
		...actual,
		SortableContext: ({children,}: {children?: ReactNode},) => children,
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
import type {RemovalReason,} from '../schema'
import {formOwnedKeys, RemovalReasonList,} from './RemovalReasonList'

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
	;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
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

describe('RemovalReasonList edit field preservation', () => {
	/**
	 * Opens the first reason's edit form and saves it without touching any field,
	 * then returns whatever was written back to the config.
	 */
	async function editAndSaveUntouched (state: ConfigState,) {
		renderList(state,)
		const editButton = container.querySelector<HTMLButtonElement>('button[title="Edit"]',)
		expect(editButton,).toBeTruthy()
		await act(async () => editButton!.click())
		act(() => {
			getButton('Save reason',).click()
		},)
		expect(onSave,).toHaveBeenCalledOnce()
		return state.config.removalReasons.reasons[0]!
	}

	/** A reason carrying every field the form does not own. */
	const preservedFields = {
		id: 'abcd1234',
		text: 'Rule reason',
		title: 'A reason',
		removePosts: true,
		flairText: '',
		flairCSS: '',
		flairTemplateID: '',
		editable: true,
		nativeReasonId: 'native-xyz',
	}

	it('keeps editable across an edit', async () => {
		const saved = await editAndSaveUntouched(makeState([{...preservedFields,},],),)
		expect(saved.editable,).toBe(true,)
	})

	it('keeps nativeReasonId across an edit, so a synced reason is not orphaned', async () => {
		const saved = await editAndSaveUntouched(makeState([{...preservedFields,},],),)
		expect(saved.nativeReasonId,).toBe('native-xyz',)
	})

	it('keeps a field the form knows nothing about', async () => {
		// The form rebuilds the reason from its own state, so anything outside
		// formOwnedKeys has to survive by being carried, not by being re-emitted.
		const saved = await editAndSaveUntouched(
			makeState([{...preservedFields, someFutureField: 'kept',},],),
		)
		expect(saved.someFutureField,).toBe('kept',)
	})

	it('still lets the form clear a field it owns', async () => {
		// Preservation must not resurrect an omitted form-owned field: unchecking
		// Comments has to win over the original's removeComments: true.
		const state = makeState([{...preservedFields, removeComments: true,},],)
		renderList(state,)
		const editButton = container.querySelector<HTMLButtonElement>('button[title="Edit"]',)
		await act(async () => editButton!.click())
		act(() => {
			getCheckbox('Comments',).click()
		},)
		act(() => {
			getButton('Save reason',).click()
		},)

		const saved = state.config.removalReasons.reasons[0]!
		expect('removeComments' in saved,).toBe(false,)
		// ...while the preserved fields are still there.
		expect(saved.nativeReasonId,).toBe('native-xyz',)
	})

	it('classifies every RemovalReason field as form-owned or deliberately preserved', () => {
		// Compile-time guard: adding a field to RemovalReason without deciding whether the
		// form owns it (add to formOwnedKeys) or it rides through untouched (add below)
		// fails typecheck here rather than silently dropping the field on every edit.
		expectTypeOf<
			Exclude<keyof RemovalReason, typeof formOwnedKeys[number] | 'id' | 'editable' | 'nativeReasonId'>
		>().toEqualTypeOf<never>()
	})
})

describe('RemovalReasonList message preview toggle', () => {
	const reasonText = 'Broke a rule:\n\n{choice#rule}\n- Rule 1\n- Rule 2'

	it('swaps the textarea for the rendered controls and back, preserving the text', async () => {
		const state = makeState([{
			id: 'abcd1234',
			text: reasonText,
			title: 'A reason',
			removePosts: true,
			flairText: '',
			flairCSS: '',
			flairTemplateID: '',
		},],)
		renderList(state,)

		const editButton = container.querySelector<HTMLButtonElement>('button[title="Edit"]',)
		await act(async () => editButton!.click())

		// Edit mode: the textarea holds the text and nothing is rendered yet.
		expect(container.querySelector<HTMLTextAreaElement>('textarea',)?.value,).toBe(reasonText,)
		expect(container.querySelector('.toolbox-radio-group',),).toBeNull()

		// Preview mode: the textarea is replaced by the token-aware render, so the
		// {choice} block shows as a radio group rather than literal token text.
		act(() => getButton('Preview',).click())
		expect(container.querySelector('textarea',),).toBeNull()
		expect(container.querySelector('.toolbox-radio-group',),).toBeTruthy()
		expect(container.textContent,).toContain('Rule 1',)
		expect(container.textContent,).toContain('Rule 2',)
		expect(container.textContent,).not.toContain('{choice#rule}',)

		// Back to edit: the textarea returns with the text untouched.
		act(() => getButton('Edit',).click())
		expect(container.querySelector<HTMLTextAreaElement>('textarea',)?.value,).toBe(reasonText,)
	})

	it('shows an empty-state message when previewing a blank reason', async () => {
		const addRef = renderList(makeState([],),)
		await act(async () => addRef.current!())

		act(() => getButton('Preview',).click())

		expect(container.textContent,).toContain('Nothing to preview yet.',)
		expect(container.querySelector('.toolbox-radio-group',),).toBeNull()
	})
})
