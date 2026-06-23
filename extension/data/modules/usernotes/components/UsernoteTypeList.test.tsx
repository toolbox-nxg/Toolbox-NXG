/** Tests for the usernote type card editor. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

const getUserNotes = vi.hoisted(() => vi.fn())
const saveUserNotes = vi.hoisted(() => vi.fn().mockResolvedValue(undefined,))

vi.mock('../../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
	mountPopup: vi.fn(),
}),)
vi.mock('../../../store/feedback', () => ({
	negativeTextFeedback: vi.fn(),
	neutralTextFeedback: vi.fn(),
	positiveTextFeedback: vi.fn(),
}),)
vi.mock('../../../util/infra/logging', () => ({default: () => ({debug: vi.fn(), error: vi.fn(),}),}),)
vi.mock('../../config/moduleapi', () => ({
	reloadConfigFromWiki: vi.fn(),
	saveToolboxConfig: vi.fn().mockResolvedValue(undefined,),
}),)
vi.mock('../../shared/usernotes/moduleapi', () => ({getUserNotes, saveUserNotes,}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {SortModeRef,} from '../../../shared/controls/SortToggleButton'
import type {ConfigState,} from '../../../util/wiki/schemas/config/schema'
import type {UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {UsernoteTypeList, UsernoteTypeListFooter,} from './UsernoteTypeList'

const roots: Root[] = []

/** Builds a minimal ConfigState for testing; types are loaded from getUserNotes, not from config. */
function makeState (): ConfigState {
	return {
		config: {},
		subreddit: 'testsub',
		postFlairTemplates: null,
		userFlairTemplates: null,
	} as ConfigState
}

async function renderList (state: ConfigState,) {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	const saveRef: {current: (() => void) | null} = {current: null,}
	const sortRef: SortModeRef = {toggle: null, onChange: null,}

	await act(async () => {
		root.render(
			<>
				<UsernoteTypeList state={state} saveRef={saveRef} sortRef={sortRef} />
				<UsernoteTypeListFooter sortRef={sortRef} onSave={() => saveRef.current?.()} />
			</>,
		)
		await Promise.resolve()
	},)

	return {host, saveRef,}
}

function setInputValue (input: HTMLInputElement, value: string,) {
	act(() => {
		const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input,), 'value',)?.set
		valueSetter?.call(input, value,)
		input.dispatchEvent(new InputEvent('input', {bubbles: true, data: value,},),)
	},)
}

function click (element: Element,) {
	act(() => {
		element.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
	},)
}

function clickByText (host: HTMLElement, text: string,) {
	const button = Array.from(host.querySelectorAll('button',),).find((b,) => b.textContent?.includes(text,))
	expect(button,).toBeDefined()
	click(button!,)
}

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
	getUserNotes.mockReset()
	getUserNotes.mockRejectedValue(new Error('no_page',),)
	saveUserNotes.mockClear()
	vi.clearAllMocks()
},)

getUserNotes.mockRejectedValue(new Error('no_page',),)

describe('UsernoteTypeList', () => {
	it('renders a card per default type with no key input', async () => {
		const state = makeState()
		const {host,} = await renderList(state,)

		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(7,)
		expect(host.querySelector('input[name="type-key"]',),).toBeNull()
		expect(host.textContent,).toContain('Good Contributor',)
	})

	it('preserves an existing key when the type is renamed', async () => {
		getUserNotes.mockResolvedValue({
			ver: 6,
			users: {},
			types: [{key: 'gooduser', text: 'Good Contributor', color: 'green',},],
		},)
		const state = makeState()
		const {host, saveRef,} = await renderList(state,)

		setInputValue(host.querySelector<HTMLInputElement>('input[name="type-name"]',)!, 'Great Contributor',)
		await act(async () => {
			saveRef.current!()
			await Promise.resolve()
			await Promise.resolve()
		},)

		expect(saveUserNotes,).toHaveBeenCalledWith(
			'testsub',
			expect.objectContaining({types: [{key: 'gooduser', text: 'Great Contributor', color: 'green',},],},),
			'Updated usernote types',
		)
	})

	it('generates a key for new types and serializes optional fields only when set', async () => {
		getUserNotes.mockResolvedValue({
			ver: 6,
			users: {},
			types: [{key: 'gooduser', text: 'Good Contributor', color: 'green', colorDark: '#53b953',},],
		},)
		const state = makeState()
		const {host, saveRef,} = await renderList(state,)

		clickByText(host, 'Add usernote type',)
		const nameInputs = host.querySelectorAll<HTMLInputElement>('input[name="type-name"]',)
		setInputValue(nameInputs[nameInputs.length - 1]!, 'New type',)
		await act(async () => {
			saveRef.current!()
			await Promise.resolve()
			await Promise.resolve()
		},)

		expect(saveUserNotes,).toHaveBeenCalledTimes(1,)
		const savedTypes = (saveUserNotes.mock.calls[0]![1] as {types: UserNoteColor[]}).types
		expect(savedTypes,).toHaveLength(2,)
		expect(savedTypes[0],).toEqual(
			{key: 'gooduser', text: 'Good Contributor', color: 'green', colorDark: '#53b953',},
		)
		// The new type gets a generated key and no optional fields.
		expect(savedTypes[1]!.key,).toMatch(/^[a-z0-9]{8}$/,)
		expect(savedTypes[1],).toEqual({key: savedTypes[1]!.key, text: 'New type', color: '#ffffff',},)
	})

	it('refuses to save a type without a name', async () => {
		getUserNotes.mockResolvedValue({ver: 6, users: {}, types: [{key: 'gooduser', text: '', color: 'green',},],},)
		const state = makeState()
		const {host, saveRef,} = await renderList(state,)

		act(() => saveRef.current!())

		expect(saveUserNotes,).not.toHaveBeenCalled()
		expect(host.textContent,).toContain('Name cannot be empty.',)
	})

	it('shows usage counts and requires confirmation to delete an in-use type', async () => {
		getUserNotes.mockResolvedValue({
			ver: 6,
			users: {
				alice: {notes: [{note: 'a', type: 'gooduser', mod: 'm', time: 1,},],},
				bob: {notes: [{note: 'b', type: 'gooduser', mod: 'm', time: 2,},],},
			},
			types: [
				{key: 'gooduser', text: 'Good Contributor', color: 'green',},
				{key: 'unused', text: 'Unused', color: 'red',},
			],
		},)
		const state = makeState()
		const {host,} = await renderList(state,)

		expect(host.textContent,).toContain('2 notes',)

		// Deleting the in-use type asks for confirmation first.
		click(host.querySelectorAll('button[title="Remove"]',)[0]!,)
		expect(host.textContent,).toContain('Delete this type?',)
		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(2,)
		clickByText(host, 'Delete',)
		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(1,)

		// The unused type deletes immediately.
		click(host.querySelector('button[title="Remove"]',)!,)
		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(0,)
	})

	it('omits usage chips when notes cannot be loaded and deletes without confirmation', async () => {
		// getUserNotes rejects by default (set in afterEach); falls back to defaultUsernoteTypes.
		const state = makeState()
		const {host,} = await renderList(state,)

		expect(host.textContent,).not.toContain('notes',)
		const initialCount = host.querySelectorAll('input[name="type-name"]',).length
		click(host.querySelector('button[title="Remove"]',)!,)
		// Deletion happens immediately - no confirmation bar for in-use types (counts unknown).
		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(initialCount - 1,)
	})

	it('collapses cards to headers in sort mode and expands when done', async () => {
		const state = makeState()
		const {host,} = await renderList(state,)
		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(7,)

		// Entering sort mode via the footer toggle collapses every card body.
		clickByText(host, 'Collapse for sorting',)
		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(0,)
		// Headers stay visible.
		expect(host.textContent,).toContain('Good Contributor',)

		// Leaving sort mode expands again.
		clickByText(host, 'Expand cards',)
		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(7,)
	})
})
