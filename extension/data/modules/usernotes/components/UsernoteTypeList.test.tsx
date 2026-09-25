/** Tests for the usernote type card editor. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

const getUserNotes = vi.hoisted(() => vi.fn())
const updateUserNotes = vi.hoisted(() => vi.fn().mockResolvedValue(undefined,))
const refreshClassicConfigInlineFields = vi.hoisted(() => vi.fn().mockResolvedValue({ok: true,},))
const unsyncedClassicEditsWarning = vi.hoisted(() => vi.fn().mockResolvedValue(undefined,))
const negativeTextFeedback = vi.hoisted(() => vi.fn())
const positiveTextFeedback = vi.hoisted(() => vi.fn())

vi.mock('../../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
	mountPopup: vi.fn(),
}),)
vi.mock('../../../store/feedback', () => ({
	negativeTextFeedback,
	neutralTextFeedback: vi.fn(),
	positiveTextFeedback,
}),)
vi.mock('../../../util/infra/logging', () => ({default: () => ({debug: vi.fn(), error: vi.fn(),}),}),)
vi.mock('../../config/moduleapi', () => ({
	refreshClassicConfigInlineFields,
	reloadConfigFromWiki: vi.fn(),
	unsyncedClassicEditsWarning,
	saveToolboxConfig: vi.fn().mockResolvedValue(undefined,),
}),)
const getSubredditColors = vi.hoisted(() => vi.fn())
vi.mock('../../shared/usernotes/moduleapi', () => ({getSubredditColors, getUserNotes, updateUserNotes,}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {SortModeRef,} from '../../../shared/controls/SortToggleButton'
import type {ConfigState,} from '../../../util/wiki/schemas/config/schema'
import {defaultUsernoteTypes,} from '../../../util/wiki/schemas/usernotes/schema'
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
	updateUserNotes.mockClear()
	refreshClassicConfigInlineFields.mockClear()
	negativeTextFeedback.mockClear()
	positiveTextFeedback.mockClear()
	vi.clearAllMocks()
},)

getUserNotes.mockRejectedValue(new Error('no_page',),)
getSubredditColors.mockResolvedValue(defaultUsernoteTypes,)

/**
 * Replays the transform the type editor handed to `updateUserNotes` against a
 * fresh dataset, returning the subreddit, revision reason, and the type list it
 * would persist - mirroring the queued read-merge-write in the module API.
 */
function serializedTypes () {
	expect(updateUserNotes,).toHaveBeenCalledTimes(1,)
	const [subreddit, transform,] = updateUserNotes.mock.calls[0]! as [
		string,
		(n: {ver: number; users: Record<string, unknown>; types?: UserNoteColor[]},) => string | undefined,
	]
	const fresh = {ver: 6, users: {},} as {ver: number; users: Record<string, unknown>; types?: UserNoteColor[]}
	const reason = transform(fresh,)
	return {subreddit, reason, types: fresh.types ?? [],}
}

describe('UsernoteTypeList', () => {
	it('renders a card per default type with no key input', async () => {
		const state = makeState()
		const {host,} = await renderList(state,)

		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(7,)
		expect(host.querySelector('input[name="type-key"]',),).toBeNull()
		expect(host.textContent,).toContain('Good Contributor',)
	})

	it('shows the configured types, not the defaults, for a sub with no usernotes', async () => {
		getSubredditColors.mockResolvedValueOnce([{key: 'rant', text: 'Rant Warning', color: '#800080',},],)
		const state = makeState()
		const {host,} = await renderList(state,)

		await vi.waitFor(() => expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(1,))
		expect(host.querySelector<HTMLInputElement>('input[name="type-name"]',)!.value,).toBe('Rant Warning',)
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

		const {subreddit, reason, types,} = serializedTypes()
		expect(subreddit,).toBe('testsub',)
		expect(reason,).toBe('Updated usernote types',)
		expect(types,).toEqual([{key: 'gooduser', text: 'Great Contributor', color: 'green',},],)
		// The classic config page (6.x's copy, and the only storage on legacy subs) is rewritten.
		expect(refreshClassicConfigInlineFields,).toHaveBeenCalledWith('testsub', 'Updated usernote types',)
		expect(positiveTextFeedback,).toHaveBeenCalledWith('Usernote types saved',)
	})

	it('shows the 6.x overwrite warning instead of the success message', async () => {
		getUserNotes.mockResolvedValue({
			ver: 6,
			users: {},
			types: [{key: 'gooduser', text: 'Good Contributor', color: 'green',},],
		},)
		unsyncedClassicEditsWarning.mockResolvedValueOnce('overwrote 6.x changes',)
		const state = makeState()
		const {saveRef,} = await renderList(state,)

		await act(async () => {
			saveRef.current!()
		},)

		await vi.waitFor(() => expect(negativeTextFeedback,).toHaveBeenCalled())
		expect(unsyncedClassicEditsWarning,).toHaveBeenCalledWith('testsub', 'usernoteColors',)
		// Checked before the save bumps the NXG page.
		expect(unsyncedClassicEditsWarning.mock.invocationCallOrder[0],).toBeLessThan(
			updateUserNotes.mock.invocationCallOrder[0]!,
		)
		expect(negativeTextFeedback.mock.calls[0]![0],).toBe('overwrote 6.x changes',)
		expect(positiveTextFeedback,).not.toHaveBeenCalled()
	})

	it('warns when the classic config page could not be rewritten', async () => {
		getUserNotes.mockResolvedValue({
			ver: 6,
			users: {},
			types: [{key: 'gooduser', text: 'Good Contributor', color: 'green',},],
		},)
		refreshClassicConfigInlineFields.mockResolvedValueOnce({ok: false, message: 'no wiki permission',},)
		const state = makeState()
		const {saveRef,} = await renderList(state,)

		await act(async () => {
			saveRef.current!()
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()
		},)

		expect(positiveTextFeedback,).not.toHaveBeenCalled()
		expect(negativeTextFeedback.mock.calls[0]![0],).toContain('no wiki permission',)
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

		const savedTypes = serializedTypes().types
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

		expect(updateUserNotes,).not.toHaveBeenCalled()
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

	it('merges one type\'s notes into another on save, including notes added since loading', async () => {
		getUserNotes.mockResolvedValue({
			ver: 6,
			users: {
				alice: {
					notes: [{note: 'a', type: 'spamwarn', mod: 'm', time: 1,}, {
						note: 'b',
						type: 'spamwarn',
						mod: 'm',
						time: 2,
					},],
				},
				bob: {notes: [{note: 'c', type: 'rant', mod: 'm', time: 3,},],},
			},
			types: [
				{key: 'spamwarn', text: 'Spam Warning', color: 'purple',},
				{key: 'rant', text: 'Rant Warning', color: '#800080',},
				{key: 'gooduser', text: 'Good Contributor', color: 'green',},
			],
		},)
		const {host, saveRef,} = await renderList(makeState(),)

		// Only types with notes to move offer a merge.
		const mergeButtons = Array.from(host.querySelectorAll('button',),).filter((b,) =>
			b.textContent === 'Merge into...'
		)
		expect(mergeButtons,).toHaveLength(2,)
		click(mergeButtons[0]!,)

		const select = host.querySelector<HTMLSelectElement>('select[aria-label="Type to merge into"]',)!
		// Counts tell apart types that share a name; the merging type itself is not offered.
		expect(Array.from(select.options,).map((o,) => o.textContent),).toEqual([
			'Choose a type...',
			'Rant Warning (1 note)',
			'Good Contributor',
		],)
		const confirm = Array.from(host.querySelectorAll('button',),).find((b,) => b.textContent === 'Merge')!
		expect(confirm.disabled,).toBe(true,)
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value',)!.set!.call(select, 'rant',)
			select.dispatchEvent(new Event('change', {bubbles: true,},),)
		},)
		click(confirm,)

		// The merged-away card is gone and its notes count toward the target.
		expect(host.querySelectorAll('input[name="type-name"]',),).toHaveLength(2,)
		expect(host.textContent,).toContain('3 notes',)

		type Dataset = {ver: number; users: Record<string, {notes: {type?: string}[]}>; types?: UserNoteColor[]}
		// A spamwarn note another mod added after the panel loaded moves too.
		const fresh: Dataset = {
			ver: 6,
			users: {
				alice: {notes: [{type: 'spamwarn',}, {type: 'spamwarn',},],},
				bob: {notes: [{type: 'rant',},],},
				carol: {notes: [{type: 'spamwarn',}, {type: 'gooduser',},],},
			},
		}
		let reason: string | undefined
		updateUserNotes.mockImplementationOnce((_sub: string, transform: (n: Dataset,) => string,) => {
			reason = transform(fresh,)
			return Promise.resolve(fresh,)
		},)
		await act(async () => {
			saveRef.current!()
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()
		},)

		expect(reason,).toBe('Merged usernote types',)
		expect(Object.values(fresh.users,).flatMap((u,) => u.notes.map((n,) => n.type)),).toEqual([
			'rant',
			'rant',
			'rant',
			'rant',
			'gooduser',
		],)
		expect(fresh.types!.map((t,) => t.key),).toEqual(['rant', 'gooduser',],)
		expect(positiveTextFeedback,).toHaveBeenCalledWith('Usernote types saved; 3 notes moved',)
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
