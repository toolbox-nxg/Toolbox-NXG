/** Tests for NativeNoteComposer. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

const createModNote = vi.hoisted(() => vi.fn())
const proposeOrBan = vi.hoisted(() => vi.fn())
// Personal setting `banWithBanLabel`; undefined falls through to the hook's default.
const banWithBanLabel = vi.hoisted(() => ({value: undefined as boolean | undefined,}))
const banNoteDuration = vi.hoisted(() => ({value: undefined as string | null | undefined,}))

vi.mock('../../../api/resources/modnotes', () => ({createModNote,}),)
vi.mock('../../shared/proposals/gateway', () => ({proposeOrBan,}),)
vi.mock('../../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
}),)
vi.mock('../../../util/ui/hooks', () => ({
	useSetting: (_module: string, key: string, fallback: unknown,) => {
		if (key === 'banWithBanLabel' && banWithBanLabel.value !== undefined) {
			return banWithBanLabel.value
		}
		if (key === 'banNoteDuration' && banNoteDuration.value !== undefined) {
			return banNoteDuration.value
		}
		return fallback
	},
}),)
vi.mock('../../../store', () => ({default: {dispatch: vi.fn(), getState: vi.fn(), subscribe: vi.fn(),},}),)
vi.mock('../../../store/feedback', () => ({positiveTextFeedback: vi.fn(),}),)
vi.mock('../../../util/infra/logging', () => ({default: () => ({error: vi.fn(),}),}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {NativeNoteComposer,} from './NativeNoteComposer'

const roots: Root[] = []

function renderComposer (props: Partial<React.ComponentProps<typeof NativeNoteComposer>> = {},) {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	const onSaved = vi.fn()
	act(() => {
		root.render(
			<NativeNoteComposer subreddit="testsub" user="alice" contextID="t1_abc" onSaved={onSaved} {...props} />,
		)
	},)
	return {host, onSaved,}
}

function noteInput (host: HTMLElement,) {
	return host.querySelector<HTMLInputElement>('input[placeholder="Add a note..."]',)!
}

function setBanDays (host: HTMLElement, value: string,) {
	const input = host.querySelector<HTMLInputElement>('input[type="number"]',)!
	act(() => {
		const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input,), 'value',)?.set
		valueSetter?.call(input, value,)
		input.dispatchEvent(new InputEvent('input', {bubbles: true, data: value,},),)
	},)
}

function applyFirstMacro (host: HTMLElement,) {
	const select = host.querySelector<HTMLSelectElement>('select[aria-label="Apply ban macro"]',)!
	act(() => {
		select.value = '0'
		select.dispatchEvent(new Event('change', {bubbles: true,},),)
	},)
}

function setNoteText (host: HTMLElement, value: string,) {
	const input = host.querySelector<HTMLInputElement>('input[placeholder="Add a note..."]',)!
	act(() => {
		const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input,), 'value',)?.set
		valueSetter?.call(input, value,)
		input.dispatchEvent(new InputEvent('input', {bubbles: true, data: value,},),)
	},)
}

function findButton (host: HTMLElement, text: string,) {
	const button = Array.from(host.querySelectorAll('button',),).find((button,) => button.textContent === text)
	expect(button,).toBeDefined()
	return button!
}

async function click (element: HTMLElement,) {
	await act(async () => {
		element.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
		await Promise.resolve()
	},)
}

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
	banWithBanLabel.value = undefined
	banNoteDuration.value = undefined
	vi.clearAllMocks()
},)

describe('NativeNoteComposer', () => {
	it('does not offer AI-generated user summary as a label', () => {
		const {host,} = renderComposer()

		const labels = Array.from(host.querySelectorAll('button[aria-pressed]',),).map((button,) => button.textContent)
		expect(labels,).toContain('Helpful User',)
		expect(labels,).not.toContain('AI-generated user summary',)
	})

	it('requires note text before saving', async () => {
		const {host, onSaved,} = renderComposer()

		await click(findButton(host, 'Save for /r/testsub',),)

		expect(createModNote,).not.toHaveBeenCalled()
		expect(onSaved,).not.toHaveBeenCalled()
		expect(host.textContent,).toContain('Note text is required',)
	})

	it('saves the note with its label and context', async () => {
		createModNote.mockResolvedValue(undefined,)
		const {host, onSaved,} = renderComposer()

		await click(findButton(host, 'Spam Watch',),)
		setNoteText(host, '  watch this  ',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(createModNote,).toHaveBeenCalledWith({
			user: 'alice',
			subreddit: 'testsub',
			redditID: 't1_abc',
			note: 'watch this',
			label: 'SPAM_WATCH',
		},)
		expect(proposeOrBan,).not.toHaveBeenCalled()
		expect(onSaved,).toHaveBeenCalledTimes(1,)
	})

	it('preselects the default label', () => {
		const {host,} = renderComposer({defaultLabel: 'BAN',},)

		expect(findButton(host, 'Ban',).getAttribute('aria-pressed',),).toBe('true',)
	})

	it('bans the user alongside a Ban note', async () => {
		createModNote.mockResolvedValue(undefined,)
		proposeOrBan.mockResolvedValue(undefined,)
		const {host,} = renderComposer({defaultLabel: 'BAN',},)

		setNoteText(host, 'repeat offender',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(proposeOrBan,).toHaveBeenCalledWith(
			{subreddit: 'testsub', itemId: 'alice', itemKind: 'user', link: 'https://www.reddit.com/user/alice',},
			{permanent: false, days: 7, note: 'repeat offender', message: '', context: 't1_abc',},
		)
	})

	it('bans without a linked item when the note has no context', async () => {
		createModNote.mockResolvedValue(undefined,)
		proposeOrBan.mockResolvedValue(undefined,)
		const {host,} = renderComposer({defaultLabel: 'BAN', contextID: undefined,},)

		setNoteText(host, 'repeat offender',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(proposeOrBan,).toHaveBeenCalledWith(
			{subreddit: 'testsub', itemId: 'alice', itemKind: 'user', link: 'https://www.reddit.com/user/alice',},
			{permanent: false, days: 7, note: 'repeat offender', message: '',},
		)
	})

	it('fills the ban message and days from a ban macro', async () => {
		createModNote.mockResolvedValue(undefined,)
		proposeOrBan.mockResolvedValue(undefined,)
		const {host,} = renderComposer({
			defaultLabel: 'BAN',
			banTokenInfo: {author: 'alice', subreddit: 'testsub', mod: 'testmod',},
			savedBanMacros: [{
				title: 'Spam',
				note: 'n',
				message: 'Bye {author} from {mod}',
				permanent: false,
				days: 30,
			},],
		},)

		const select = host.querySelector<HTMLSelectElement>('select[aria-label="Apply ban macro"]',)!
		act(() => {
			select.value = '0'
			select.dispatchEvent(new Event('change', {bubbles: true,},),)
		},)
		setNoteText(host, 'spammer',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(proposeOrBan,).toHaveBeenCalledWith(
			expect.anything(),
			{permanent: false, days: 30, note: 'spammer', message: 'Bye alice from testmod', context: 't1_abc',},
		)
	})

	it('never bans a moderator', async () => {
		createModNote.mockResolvedValue(undefined,)
		const {host,} = renderComposer({defaultLabel: 'PERMA_BAN', targetIsMod: true,},)

		expect(host.textContent,).toContain('(user is a mod)',)
		setNoteText(host, 'mod note',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(createModNote,).toHaveBeenCalled()
		expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]',)!.checked,).toBe(false,)
		expect(proposeOrBan,).not.toHaveBeenCalled()
	})

	it('starts the ban from the subreddit defaults', async () => {
		createModNote.mockResolvedValue(undefined,)
		proposeOrBan.mockResolvedValue(undefined,)
		const {host,} = renderComposer({
			defaultLabel: 'BAN',
			banDefaults: {note: '', message: 'You are banned from r/testsub', permanent: false, days: 3,},
		},)

		setNoteText(host, 'repeat offender',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(proposeOrBan,).toHaveBeenCalledWith(
			expect.anything(),
			{
				permanent: false,
				days: 3,
				note: 'repeat offender',
				message: 'You are banned from r/testsub',
				context: 't1_abc',
			},
		)
	})

	it('leaves the ban off for a Ban label when the setting is off', async () => {
		banWithBanLabel.value = false
		createModNote.mockResolvedValue(undefined,)
		const {host,} = renderComposer({defaultLabel: 'BAN',},)

		expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]',)!.checked,).toBe(false,)
		setNoteText(host, 'already banned elsewhere',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(createModNote,).toHaveBeenCalled()
		expect(proposeOrBan,).not.toHaveBeenCalled()
	})

	it('offers no ban for Ban or Permaban when the subreddit turns native note bans off', async () => {
		createModNote.mockResolvedValue(undefined,)
		const {host,} = renderComposer({defaultLabel: 'PERMA_BAN', banDisabled: true,},)

		expect(host.textContent,).not.toContain('Issue Permanent Ban',)
		expect(host.querySelector('input[type="checkbox"]',),).toBeNull()
		setNoteText(host, 'note only',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(createModNote,).toHaveBeenCalled()
		expect(proposeOrBan,).not.toHaveBeenCalled()
	})

	it('refuses an empty ban message when the subreddit requires one', async () => {
		const {host,} = renderComposer({defaultLabel: 'PERMA_BAN', requireBanMessage: true,},)

		setNoteText(host, 'permaban',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(createModNote,).not.toHaveBeenCalled()
		expect(host.textContent,).toContain('/r/testsub requires a ban message',)
	})

	it('does not require a ban message for a note without a ban', async () => {
		createModNote.mockResolvedValue(undefined,)
		const {host,} = renderComposer({requireBanMessage: true,},)

		setNoteText(host, 'just a note',)
		await click(findButton(host, 'Save for /r/testsub',),)

		expect(createModNote,).toHaveBeenCalled()
	})

	it('warns about tokens it cannot fill instead of dropping them', () => {
		const {host,} = renderComposer({
			defaultLabel: 'BAN',
			banDefaults: {note: '', message: 'Banned for {url}', permanent: false,},
		},)

		expect(host.querySelector<HTMLTextAreaElement>('textarea',)!.value,).toBe('Banned for {url}',)
		expect(host.textContent,).toContain('{url} can',)
	})

	describe('banNoteDuration', () => {
		it('sets ban days from a matching note duration regex', async () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '5d Toxicity',)

			expect(host.textContent,).toContain('(from note)',)
			await click(findButton(host, 'Save for /r/testsub',),)

			expect(proposeOrBan,).toHaveBeenCalledWith(
				{subreddit: 'testsub', itemId: 'alice', itemKind: 'user', link: 'https://www.reddit.com/user/alice',},
				{permanent: false, days: 5, note: '5d Toxicity', message: '', context: 't1_abc',},
			)
		})

		it('resets ban days to the subreddit default when the note no longer matches', async () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({
				defaultLabel: 'BAN',
				banDefaults: {note: '', message: '', permanent: false, days: 3,},
			},)

			setNoteText(host, '5d Toxicity',)
			setNoteText(host, 'No duration specified',)

			expect(host.textContent,).not.toContain('(must be a whole number of days from 1 to 999)',)
			await click(findButton(host, 'Save for /r/testsub',),)

			expect(proposeOrBan,).toHaveBeenCalledWith(
				{subreddit: 'testsub', itemId: 'alice', itemKind: 'user', link: 'https://www.reddit.com/user/alice',},
				{permanent: false, days: 3, note: 'No duration specified', message: '', context: 't1_abc',},
			)
		})

		it('uses the default ban duration when no regex is configured', async () => {
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({
				defaultLabel: 'BAN',
				banDefaults: {note: '', message: '', permanent: false, days: 3,},
			},)

			setNoteText(host, '5d Toxicity',)

			expect(host.textContent,).not.toContain('(must be a whole number of days from 1 to 999)',)
			await click(findButton(host, 'Save for /r/testsub',),)

			expect(proposeOrBan,).toHaveBeenCalledWith(
				{subreddit: 'testsub', itemId: 'alice', itemKind: 'user', link: 'https://www.reddit.com/user/alice',},
				{permanent: false, days: 3, note: '5d Toxicity', message: '', context: 't1_abc',},
			)
		})

		it.each([
			{note: '0d zero duration', days: '0',},
		],)('flags invalid ban duration for $note', async ({note, days,},) => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, note,)

			expect(host.querySelector<HTMLInputElement>('input[type="number"]',)!.value,).toBe(days,)
			expect(host.textContent,).toContain('(must be a whole number of days from 1 to 999)',)
			expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(true,)

			await click(findButton(host, 'Save for /r/testsub',),)

			expect(createModNote,).not.toHaveBeenCalled()
			expect(proposeOrBan,).not.toHaveBeenCalled()
		},)

		it('clears invalid ban duration when the note is corrected', async () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '0d zero duration',)
			expect(host.querySelector<HTMLInputElement>('input[type="number"]',)!.value,).toBe('0',)
			expect(host.textContent,).toContain('(must be a whole number of days from 1 to 999)',)
			expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(true,)

			setNoteText(host, '5d Toxicity',)

			expect(host.textContent,).not.toContain('(must be a whole number of days from 1 to 999)',)
			await click(findButton(host, 'Save for /r/testsub',),)

			expect(proposeOrBan,).toHaveBeenCalledWith(
				{subreddit: 'testsub', itemId: 'alice', itemKind: 'user', link: 'https://www.reddit.com/user/alice',},
				{permanent: false, days: 5, note: '5d Toxicity', message: '', context: 't1_abc',},
			)
		})

		it('does not break the composer when the pattern is not a valid regex', async () => {
			banNoteDuration.value = String.raw`^(\d+d`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '5d Toxicity',)

			expect(host.textContent,).toContain('(duration pattern is invalid)',)
			await click(findButton(host, 'Save for /r/testsub',),)
			expect(proposeOrBan,).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({days: 7, note: '5d Toxicity',},),
			)
		})

		describe('a note longer than Reddit allows', () => {
			const pattern = String.raw`^\s*(\d+)d\s+`
			const overMaxHint = '(note says 1500; Reddit allows at most 999)'

			function daysInput (host: HTMLElement,) {
				return host.querySelector<HTMLInputElement>('input[type="number"]',)!
			}

			it('blocks saving until the mod confirms the shorter ban, showing what the note says', async () => {
				banNoteDuration.value = pattern
				const {host,} = renderComposer({defaultLabel: 'BAN',},)

				setNoteText(host, '1500d ban evasion',)

				expect(daysInput(host,).value,).toBe('1500',)
				expect(daysInput(host,).getAttribute('aria-invalid',),).toBe('true',)
				expect(host.textContent,).toContain(overMaxHint,)
				expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(true,)
				await click(findButton(host, 'Save for /r/testsub',),)
				expect(createModNote,).not.toHaveBeenCalled()
				expect(proposeOrBan,).not.toHaveBeenCalled()
			})

			it('says why when Enter is pressed before confirming', async () => {
				banNoteDuration.value = pattern
				const {host,} = renderComposer({defaultLabel: 'BAN',},)

				setNoteText(host, '1500d ban evasion',)
				await act(async () => {
					noteInput(host,).dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true,},),)
					await Promise.resolve()
				},)

				expect(host.textContent,).toContain('Reddit bans for at most 999 days',)
				expect(createModNote,).not.toHaveBeenCalled()
			})

			it('bans for 999 days once confirmed, keeping the note as written', async () => {
				banNoteDuration.value = pattern
				createModNote.mockResolvedValue(undefined,)
				proposeOrBan.mockResolvedValue(undefined,)
				const {host,} = renderComposer({defaultLabel: 'BAN',},)

				setNoteText(host, '1500d ban evasion',)
				await click(findButton(host, 'Ban for 999 days',),)

				expect(daysInput(host,).value,).toBe('999',)
				expect(noteInput(host,).value,).toBe('1500d ban evasion',)
				expect(host.textContent,).toContain('(note says 1500; 999 is the most Reddit allows)',)
				await click(findButton(host, 'Save for /r/testsub',),)

				expect(createModNote,).toHaveBeenCalledWith(expect.objectContaining({note: '1500d ban evasion',},),)
				expect(proposeOrBan,).toHaveBeenCalledWith(
					expect.anything(),
					expect.objectContaining({permanent: false, days: 999, note: '1500d ban evasion',},),
				)
			})

			it('asks again when the length in the note changes after confirming', async () => {
				banNoteDuration.value = pattern
				const {host,} = renderComposer({defaultLabel: 'BAN',},)

				setNoteText(host, '1500d ban evasion',)
				await click(findButton(host, 'Ban for 999 days',),)
				setNoteText(host, '2000d ban evasion',)

				expect(daysInput(host,).value,).toBe('2000',)
				expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(true,)
				expect(findButton(host, 'Ban for 999 days',),).toBeDefined()
			})

			it('asks again after switching label and back', async () => {
				banNoteDuration.value = pattern
				const {host,} = renderComposer({defaultLabel: 'BAN',},)

				setNoteText(host, '1500d ban evasion',)
				await click(findButton(host, 'Ban for 999 days',),)
				await click(findButton(host, 'Abuse Warning',),)
				await click(findButton(host, 'Ban',),)

				expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(true,)
			})

			it('rewrites the note when the mod types days instead of confirming', async () => {
				banNoteDuration.value = pattern
				createModNote.mockResolvedValue(undefined,)
				proposeOrBan.mockResolvedValue(undefined,)
				const {host,} = renderComposer({defaultLabel: 'BAN',},)

				setNoteText(host, '1500d ban evasion',)
				setBanDays(host, '30',)

				expect(noteInput(host,).value,).toBe('30d ban evasion',)
				await click(findButton(host, 'Save for /r/testsub',),)
				expect(proposeOrBan,).toHaveBeenCalledWith(
					expect.anything(),
					expect.objectContaining({days: 30, note: '30d ban evasion',},),
				)
			})

			it('does not apply to a Permaban, which has no day count', () => {
				banNoteDuration.value = pattern
				const {host,} = renderComposer({defaultLabel: 'PERMA_BAN',},)

				setNoteText(host, '1500d ban evasion',)

				expect(host.textContent,).not.toContain(overMaxHint,)
				expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(false,)
			})
		})

		it('lets the note be saved again once it no longer matches an invalid length', () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '0d zero duration',)
			expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(true,)
			setNoteText(host, 'zero duration',)

			expect(host.textContent,).not.toContain('(must be a whole number of days from 1 to 999)',)
			expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(false,)
		})

		it('does not block saving when the ban is turned off', () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '1000d excessive duration',)
			const toggle = host.querySelector<HTMLInputElement>('input[type="checkbox"]',)!
			act(() => toggle.click())

			expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(false,)
		})

		it('does not block saving a note under another label', async () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
			createModNote.mockResolvedValue(undefined,)
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '1000d excessive duration',)
			await click(findButton(host, 'Abuse Warning',),)

			expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(false,)
		})

		it('does not block saving when the target is a moderator', () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
			const {host,} = renderComposer({defaultLabel: 'BAN', targetIsMod: true,},)

			setNoteText(host, '1000d excessive duration',)

			expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(false,)
		})

		it('rewrites the length in the note when the mod types other days', async () => {
			banNoteDuration.value = String.raw`^\s*([\d.,]+)\s*d\b`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '5d spam',)
			setBanDays(host, '57',)

			expect(noteInput(host,).value,).toBe('57d spam',)
			await click(findButton(host, 'Save for /r/testsub',),)
			expect(proposeOrBan,).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({days: 57, note: '57d spam',},),
			)
		})

		it('fixes an invalid length in the note when the mod types valid days', () => {
			banNoteDuration.value = String.raw`^\s*([\d.,]+)\s*d\b`
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '1.5d test',)
			setBanDays(host, '2',)

			expect(noteInput(host,).value,).toBe('2d test',)
			expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(false,)
		})

		it('follows the note again when the mod edits the length in it', async () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\b`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setNoteText(host, '5d Toxicity',)
			setBanDays(host, '14',)
			setNoteText(host, '3d Toxicity',)

			await click(findButton(host, 'Save for /r/testsub',),)
			expect(proposeOrBan,).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({days: 3, note: '3d Toxicity',},),
			)
		})

		it('keeps days the mod typed while the note gives no length', async () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\b`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setBanDays(host, '14',)
			setNoteText(host, 'Toxicity',)

			expect(noteInput(host,).value,).toBe('Toxicity',)
			await click(findButton(host, 'Save for /r/testsub',),)
			expect(proposeOrBan,).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({days: 14, note: 'Toxicity',},),
			)
		})

		it('rewrites the length in the note when a ban macro sets the days', async () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\b`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({
				defaultLabel: 'BAN',
				savedBanMacros: [{title: 'Spam', note: 'n', message: 'm', permanent: false, days: 30,},],
			},)

			setNoteText(host, '5d spammer',)
			applyFirstMacro(host,)

			expect(noteInput(host,).value,).toBe('30d spammer',)
			await click(findButton(host, 'Save for /r/testsub',),)
			expect(proposeOrBan,).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({days: 30, note: '30d spammer',},),
			)
		})

		it('keeps days from a ban macro while the note gives no length', async () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\b`
			createModNote.mockResolvedValue(undefined,)
			proposeOrBan.mockResolvedValue(undefined,)
			const {host,} = renderComposer({
				defaultLabel: 'BAN',
				savedBanMacros: [{title: 'Spam', note: 'n', message: 'm', permanent: false, days: 30,},],
			},)

			applyFirstMacro(host,)
			setNoteText(host, 'spammer',)

			await click(findButton(host, 'Save for /r/testsub',),)
			expect(proposeOrBan,).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({days: 30, note: 'spammer',},),
			)
		})

		it('says when a typed note gave no length and the default is used', () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\b`
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			expect(host.textContent,).not.toContain('(default, not from note)',)
			setNoteText(host, '1.5d test',)

			expect(host.textContent,).toContain('(default, not from note)',)
			expect(host.querySelector<HTMLInputElement>('input[type="number"]',)!.value,).toBe('7',)
		})

		it('does not claim the default is used once the mod has typed days', () => {
			banNoteDuration.value = String.raw`^\s*(\d+)d\b`
			const {host,} = renderComposer({defaultLabel: 'BAN',},)

			setBanDays(host, '14',)
			setNoteText(host, 'test',)

			expect(host.textContent,).not.toContain('(default, not from note)',)
			expect(host.textContent,).not.toContain('(from note)',)
		})

		describe(String.raw`documented pattern ^\s*([\d.,]+)\s*d\b`, () => {
			const documentedPattern = String.raw`^\s*([\d.,]+)\s*d\b`

			it.each([
				{note: '5d spam', days: 5,},
				{note: '5 d spam', days: 5,},
				{note: '  30D spam', days: 30,},
			],)('reads $days days from "$note"', ({note, days,},) => {
				banNoteDuration.value = documentedPattern
				const {host,} = renderComposer({defaultLabel: 'BAN',},)

				setNoteText(host, note,)

				expect(host.querySelector<HTMLInputElement>('input[type="number"]',)!.value,).toBe(String(days,),)
				expect(host.textContent,).toContain('(from note)',)
			},)

			it.each(['1.5d test', '1,5d test', '0d test',],)(
				'flags "%s" instead of using the default',
				(note,) => {
					banNoteDuration.value = documentedPattern
					const {host,} = renderComposer({defaultLabel: 'BAN',},)

					setNoteText(host, note,)

					expect(host.textContent,).toContain('(must be a whole number of days from 1 to 999)',)
					expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(true,)
				},
			)

			it('uses the default for a note with no duration, and says so', () => {
				banNoteDuration.value = documentedPattern
				const {host,} = renderComposer({defaultLabel: 'BAN',},)

				setNoteText(host, 'spam',)

				expect(host.textContent,).toContain('(default, not from note)',)
				expect(findButton(host, 'Save for /r/testsub',).disabled,).toBe(false,)
			})
		},)

		describe(String.raw`^\s*(\d+)d\s+ Regex tests`, () => {
			it.each([
				'reason 7d',
				'7d',
				'7dreason',
				'7d-reason',
				'7d_reason',
				'-7d reason',
				'+7d reason',
				'1.5d reason',
				'7 d reason',
				'seven d reason',
				'd reason',
				'７d reason',
				'7dd reason',
			],)(`%s doesn't match regex`, async (note,) => {
				banNoteDuration.value = String.raw`^\s*(\d+)d\s+`
				const {host,} = renderComposer({
					defaultLabel: 'BAN',
					banDefaults: {note: '', message: '', permanent: false, days: 3,},
				},)

				setNoteText(host, note,)

				expect(host.textContent,).not.toContain('(must be a whole number of days from 1 to 999)',)
				await click(findButton(host, 'Save for /r/testsub',),)

				expect(proposeOrBan,).toHaveBeenCalledWith(
					{
						subreddit: 'testsub',
						itemId: 'alice',
						itemKind: 'user',
						link: 'https://www.reddit.com/user/alice',
					},
					{permanent: false, days: 3, note, message: '', context: 't1_abc',},
				)
			},)
		},)
	})
})
