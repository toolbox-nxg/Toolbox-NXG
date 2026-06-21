/** Tests for RemovalReasonsOverlay. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const removeThing = vi.hoisted(() => vi.fn())
const approveThing = vi.hoisted(() => vi.fn())
const postComment = vi.hoisted(() => vi.fn())
const flairPost = vi.hoisted(() => vi.fn())
const dndDragEnd = vi.hoisted(() => ({current: null as null | ((event: any,) => void),}))

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)

vi.mock('../../../api/resources/flair', () => ({
	flairPost,
}),)

vi.mock('../../../api/resources/modmail', () => ({
	archiveModmail: vi.fn(),
	sendModmail: vi.fn(),
}),)

vi.mock('../../../api/resources/things', () => ({
	approveThing,
	distinguishThing: vi.fn(),
	lock: vi.fn(),
	removeThing,
	sendOfficialRemovalMessage: vi.fn(),
}),)

vi.mock('../../../api/resources/comments', () => ({postComment,}),)
vi.mock('../../../api/resources/submissions', () => ({postLink: vi.fn(),}),)

// Wrap the real captureGuard but expose runInReplay as a controllable spy. Its default
// passthrough matches the real no-op authorization for non-trainees; the gate tests override
// it once to simulate the perform pipeline throwing.
const runInReplay = vi.hoisted(() => vi.fn((fn: () => unknown,) => fn()))
vi.mock('../../../util/infra/captureGuard', async () => {
	const actual = await vi.importActual<typeof import('../../../util/infra/captureGuard')>(
		'../../../util/infra/captureGuard',
	)
	return {...actual, runInReplay,}
},)

vi.mock('../../../util/persistence/cache', () => ({
	getCache: vi.fn((_namespace: string, _key: string, fallback: unknown,) => Promise.resolve(fallback,)),
	setCache: vi.fn(),
}),)

vi.mock('../../shared/removalReasons/parser', () => ({
	getRemovalReasonParser: () => ({
		render: (markdown: string,) => `<p>${markdown}</p>`,
	}),
}),)

const getSubredditColors = vi.hoisted(() => vi.fn())
vi.mock('../../shared/usernotes/moduleapi', () => ({getSubredditColors,}),)

vi.mock('@dnd-kit/core', async () => {
	const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core',)
	return {
		...actual,
		DndContext: ({children, onDragEnd,}: any,) => {
			dndDragEnd.current = onDragEnd
			return children
		},
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

import type {RemovalReason, RemovalReasonsData, RemovalReasonsOverlaySettings,} from '../schema'
import {
	type RemovalAcceptGate,
	RemovalReasonsOverlay,
	type RemovalReasonsOverlayPreseed,
} from './RemovalReasonsOverlay'

const settings: RemovalReasonsOverlaySettings = {
	reasonTypeSetting: 'reply_with_a_comment_to_the_item_that_is_removed',
	reasonAsSubSetting: false,
	reasonAutoArchiveSetting: false,
	reasonStickySetting: false,
	reasonCommentAsSubredditSetting: false,
	actionLockSetting: false,
	actionLockCommentSetting: false,
}

const reason: RemovalReason = {
	text: 'Rule reason',
	title: '',
	flairText: '',
	flairCSS: '',
	flairTemplateID: '',
}

const data: RemovalReasonsData = {
	subreddit: 'testsub',
	fullname: 't3_post',
	id: 'post',
	author: 'testuser',
	title: 'Test title',
	kind: 'submission',
	mod: 'testmod',
	url: 'https://reddit.test/item',
	link: 'https://reddit.test/post',
	domain: 'reddit.test',
	body: 'body text',
	raw_body: 'body text',
	uri_body: 'body%20text',
	uri_title: 'Test%20title',
	subject: 'Your {kind} was removed',
	logReason: '',
	header: 'Hello {author}',
	footer: 'From /r/{subreddit}',
	logSub: '',
	logTitle: 'Removed {kind}',
	reasons: [reason,],
}

let container: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn>

function renderOverlay (
	dataOverride: Partial<RemovalReasonsData> = {},
	displayMode = 'Popup',
	visibleReasons: RemovalReason[] = [reason,],
) {
	act(() => {
		root.render(
			<RemovalReasonsOverlay
				data={{...data, ...dataOverride,}}
				visibleReasons={visibleReasons}
				displayMode={displayMode}
				settings={settings}
				onClose={onClose}
			/>,
		)
	},)
}

function getButton (text: string,) {
	const button = [...container.querySelectorAll('button',),]
		.find((button,) => button.textContent?.trim() === text)
	expect(button,).toBeTruthy()
	return button!
}

beforeEach(() => {
	;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		writable: true,
		value: vi.fn(() => ({
			matches: true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	},)
	document.body.style.marginLeft = ''
	document.body.style.transition = ''
	container = document.createElement('div',)
	document.body.appendChild(container,)
	root = createRoot(container,)
	onClose = vi.fn()
	runInReplay.mockImplementation((fn: () => unknown,) => fn())
	removeThing.mockResolvedValue({},)
	flairPost.mockResolvedValue({},)
	postComment.mockResolvedValue({id: 'reply', fullname: 't1_reply',},)
	getSubredditColors.mockResolvedValue([{key: 'spamwatch', color: '#f00', text: 'Spam',},],)
},)

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	vi.clearAllMocks()
	dndDragEnd.current = null
},)

describe('RemovalReasonsOverlay', () => {
	it('closes from the titlebar without removing or approving', () => {
		renderOverlay()

		act(() => {
			container.querySelector<HTMLButtonElement>('button[aria-label="Close"]',)!.click()
		},)

		expect(onClose,).toHaveBeenCalledOnce()
		expect(removeThing,).not.toHaveBeenCalled()
		expect(approveThing,).not.toHaveBeenCalled()
	})

	it('closes from cancel without removing or approving', () => {
		renderOverlay()

		act(() => {
			getButton('Cancel',).click()
		},)

		expect(onClose,).toHaveBeenCalledOnce()
		expect(removeThing,).not.toHaveBeenCalled()
		expect(approveThing,).not.toHaveBeenCalled()
	})

	it('removes and closes from silently remove', async () => {
		renderOverlay()

		await act(async () => {
			getButton('Silently remove',).click()
		},)

		// Routes through the proposals gateway, which performs the real removal with
		// an explicit spam=false for a non-trainee.
		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(onClose,).toHaveBeenCalledOnce()
		expect(approveThing,).not.toHaveBeenCalled()
	})

	it('removes before sending a selected removal reason', async () => {
		renderOverlay()

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
			getButton('Send',).click()
		},)

		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(postComment,).toHaveBeenCalled()
		expect(onClose,).toHaveBeenCalledOnce()
	})

	it('keeps the overlay open when send cannot remove the item', async () => {
		removeThing.mockRejectedValueOnce(new Error('nope',),)
		renderOverlay()

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
			getButton('Send',).click()
		},)

		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(postComment,).not.toHaveBeenCalled()
		expect(container.textContent,).toContain('failed to remove item',)
		expect(onClose,).not.toHaveBeenCalled()
	})

	it('renders token-replaced header and footer previews', () => {
		renderOverlay()

		expect(container.textContent,).toContain('Hello testuser',)
		expect(container.textContent,).toContain('From /r/testsub',)
	})

	it('renders context links for item, subreddit, user, and domain', () => {
		renderOverlay()

		const links = [...container.querySelectorAll<HTMLAnchorElement>('a',),]
		expect(links.some((link,) => link.href === 'https://reddit.test/item'),).toBe(true,)
		expect(links.some((link,) => link.getAttribute('href',) === '/r/testsub'),).toBe(true,)
		expect(links.some((link,) => link.getAttribute('href',) === '/u/testuser'),).toBe(true,)
		expect(links.some((link,) => link.href === 'https://old.reddit.com/domain/reddit.test'),).toBe(true,)
		expect(links.every((link,) => link.target === '_blank'),).toBe(true,)
	})

	it('does not render self-post domains as domain chips', () => {
		renderOverlay({domain: 'self.testsub',},)

		expect(container.textContent,).toContain('Removing submission',)
		expect(container.textContent,).not.toContain('self.testsub',)
		expect([...container.querySelectorAll<HTMLAnchorElement>('a',),]
			.some((link,) => link.href.includes('/domain/self.testsub',)),).toBe(false,)
	})

	it('hides header and footer previews when their toggles are disabled', () => {
		renderOverlay()

		act(() => {
			container.querySelector<HTMLInputElement>('input[aria-label="Include header"]',)!.click()
			container.querySelector<HTMLInputElement>('input[aria-label="Include footer"]',)!.click()
		},)

		expect(container.textContent,).toContain('Include header',)
		expect(container.textContent,).toContain('Include footer',)
		expect(container.textContent,).not.toContain('Hello testuser',)
		expect(container.textContent,).not.toContain('From /r/testsub',)
	})

	it('renders flair metadata badges on reason cards', () => {
		renderOverlay({}, 'Popup', [{
			text: 'Rule reason',
			title: 'Rule 1',
			flairText: 'Removed',
			flairCSS: 'removed-css',
			flairTemplateID: 'template-123',
		},],)

		expect(container.textContent,).toContain('flair: Removed',)
		expect(container.textContent,).toContain('class: removed-css',)
		expect(container.textContent,).toContain('template: template-123',)
	})

	it('does not render flair metadata badges when a reason has no flair metadata', () => {
		renderOverlay()

		expect(container.textContent,).not.toContain('flair:',)
		expect(container.textContent,).not.toContain('class:',)
		expect(container.textContent,).not.toContain('template:',)
	})

	it('keeps selection on the same reason after reordering', async () => {
		renderOverlay({}, 'Popup', [
			{...reason, text: 'First reason', title: 'First',},
			{...reason, text: 'Second reason', title: 'Second',},
		],)

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
		},)

		await act(async () => {
			dndDragEnd.current?.({active: {id: 'reason-0',}, over: {id: 'reason-1',},},)
		},)

		const checkboxes = [...container.querySelectorAll<HTMLInputElement>(
			'input[aria-label^="Select removal reason"]',
		),]
		expect(checkboxes[0]!.checked,).toBe(false,)
		expect(checkboxes[1]!.checked,).toBe(true,)
	})

	it('does not toggle selection when the drag handle is clicked', () => {
		renderOverlay({}, 'Popup', [
			{...reason, text: 'First reason', title: 'First',},
		],)

		act(() => {
			container.querySelector<HTMLButtonElement>('button[aria-label="Drag to reorder removal reason"]',)!.click()
		},)

		expect(container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.checked,)
			.toBe(
				false,
			)
	})

	it('pre-selects suggested reasons by persistent id and keeps them through the mount reset', () => {
		const r1: RemovalReason = {...reason, id: 'reasonAAA', title: 'Meta', text: 'meta',}
		const r2: RemovalReason = {...reason, id: 'reasonBBB', title: 'Spam', text: 'spam',}
		act(() => {
			root.render(
				<RemovalReasonsOverlay
					data={{...data, reasons: [r1, r2,],}}
					visibleReasons={[r1, r2,]}
					displayMode="Popup"
					settings={settings}
					suggestedReasonIds={['reasonBBB',]}
					onClose={onClose}
				/>,
			)
		},)

		// The matching reason (card 2) is checked; the other stays unchecked. Before the fix, the
		// mount reset effect wiped the pre-selection and both were unchecked.
		expect(container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.checked,)
			.toBe(false,)
		expect(container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 2"]',)!.checked,)
			.toBe(true,)
	})

	it('expands selected titled reasons while keeping unselected titled reasons compact', async () => {
		renderOverlay({}, 'Popup', [
			{...reason, text: 'First reason', title: 'First',},
			{...reason, text: 'Second reason', title: 'Second',},
		],)

		const reasonContents = () =>
			[...container.querySelectorAll<HTMLDivElement>('div',),]
				.filter((el,) => ['First reason', 'Second reason',].includes(el.textContent?.trim() ?? '',))

		expect(reasonContents().map((el,) => el.style.display),).toEqual(['none', 'none',],)

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
		},)

		expect(reasonContents().map((el,) => el.style.display),).toEqual(['', 'none',],)
	})

	it('shows only the relevant delivery sub-options for the selected method', () => {
		renderOverlay()

		expect(container.textContent,).toContain('Sticky the removal comment',)
		expect(container.textContent,).not.toContain('Auto-archive sent Modmail',)

		act(() => {
			container.querySelector<HTMLInputElement>('input[value="pm"]',)!.click()
		},)

		expect(container.textContent,).not.toContain('Sticky the removal comment',)
		expect(container.textContent,).toContain('Auto-archive sent Modmail',)
	})

	it('sends selected reasons in the current card order', async () => {
		renderOverlay({}, 'Popup', [
			{...reason, text: 'First reason', title: 'First',},
			{...reason, text: 'Second reason', title: 'Second',},
		],)

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 2"]',)!.click()
		},)

		await act(async () => {
			dndDragEnd.current?.({active: {id: 'reason-0',}, over: {id: 'reason-1',},},)
		},)
		await act(async () => {
			getButton('Send',).click()
		},)

		const sentMessage = postComment.mock.calls[0]![1] as string
		expect(sentMessage.indexOf('Second reason',),).toBeLessThan(sentMessage.indexOf('First reason',),)
		expect(onClose,).toHaveBeenCalledOnce()
	})

	it('renders a {choice} block as radios and sends the chosen option in the message', async () => {
		renderOverlay({}, 'Popup', [{
			...reason,
			text: 'Broke a rule:\n\n{choice#rule}\n- Rule 1\n- Rule 2',
			title: 'Rules',
		},],)

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
		},)
		await act(async () => {
			// Pick the second radio option; the hidden input tracks the choice.
			const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"][value="Rule 2"]',),]
			expect(radios.length,).toBeGreaterThan(0,)
			radios[0]!.click()
		},)
		await act(async () => {
			getButton('Send',).click()
		},)

		const sentMessage = postComment.mock.calls[0]![1] as string
		expect(sentMessage,).toContain('Broke a rule:',)
		expect(sentMessage,).toContain('Rule 2',)
		expect(sentMessage,).not.toContain('{choice#rule}',)
		expect(onClose,).toHaveBeenCalledOnce()
	})

	it('shows a summary instead of action controls when subreddit settings are forced', () => {
		renderOverlay({
			removalOption: 'force',
			typeReply: 'both',
			typeStickied: true,
			typeCommentAsSubreddit: true,
			typeLockComment: true,
			typeAsSub: true,
			autoArchive: true,
			typeLockThread: true,
		},)

		expect(container.textContent,).toContain('requires moderators to use these removal settings',)
		expect(container.textContent,).toContain('Reply with a comment and send modmail as /r/testsub',)
		expect(container.textContent,).toContain('Sticky the removal comment',)
		expect(container.querySelector('input[type="radio"]',),).toBeNull()
	})

	it('renders drawer mode without a backdrop from the stored selector value', () => {
		renderOverlay({}, 'drawer',)

		expect(container.textContent,).toContain('Removal reasons for /r/testsub',)
		expect(container.textContent,).toContain('Silently remove',)
		expect(container.querySelector('[class*="backdrop"]',),).toBeNull()
	})

	it('uses a lower popup stack than config overlays', () => {
		renderOverlay()

		const backdrop = container.querySelector('[class*="popupBackdrop"]',)!
		expect(backdrop,).toBeTruthy()
	})

	it('highlights missing required log reason when sending', async () => {
		renderOverlay({logSub: 'logsub', logTitle: 'Removed {reason}',},)

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
			getButton('Send',).click()
		},)

		const logReasonInput = container.querySelector<HTMLInputElement>('#removal-log-reason',)!
		expect(container.textContent,).toContain('public log reason missing',)
		expect(logReasonInput.className,).toContain('errorHighlight',)
	})

	it('applies and restores body margin in drawer mode', () => {
		document.body.style.marginLeft = '12px'
		document.body.style.transition = 'opacity 1s ease'

		renderOverlay({}, 'drawer',)

		expect(document.body.style.marginLeft,).toBe('calc(12px + 420px)',)
		expect(document.body.style.transition,).toContain('margin-left 180ms ease',)

		act(() => {
			root.render(<></>,)
		},)

		expect(document.body.style.marginLeft,).toBe('12px',)
		expect(document.body.style.transition,).toBe('opacity 1s ease',)
	})

	it('closes drawer mode with Escape', () => {
		renderOverlay({}, 'drawer',)

		act(() => {
			document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape',},),)
		},)

		expect(onClose,).toHaveBeenCalledOnce()
	})
})

describe('RemovalReasonsOverlay (seeded from a proposal)', () => {
	// A reason with a persistent id and NO default_note - so the usernote auto-fill effect
	// would CLEAR a seeded note on mount if the guards didn't suppress it.
	const idReason: RemovalReason = {
		id: 'r1',
		text: 'Rule reason',
		title: 'Rule 1',
		flairText: '',
		flairCSS: '',
		flairTemplateID: '',
	}

	async function renderSeeded (
		seededFromIntent: RemovalReasonsOverlayPreseed,
		acceptGate?: RemovalAcceptGate,
	) {
		await act(async () => {
			root.render(
				<RemovalReasonsOverlay
					data={{...data,}}
					visibleReasons={[idReason,]}
					displayMode="Popup"
					settings={settings}
					seededFromIntent={seededFromIntent}
					{...(acceptGate ? {acceptGate,} : {})}
					onClose={onClose}
				/>,
			)
		},)
		// Let the seeded color-load effect resolve.
		await act(async () => {
			await Promise.resolve()
		},)
	}

	function noteTextInput () {
		return [...container.querySelectorAll<HTMLInputElement>('input',),]
			.find((i,) => i.placeholder === 'Note text')
	}

	it('seeds and preserves usernote + ban on mount (guards prevent clobbering)', async () => {
		await renderSeeded({
			reasons: [{id: 'r1', text: 'Rule reason',},],
			reasonType: 'reply',
			usernote: {text: 'seeded note', type: 'spamwatch',},
			ban: {permanent: false, days: 3, note: 'seeded ban',},
		}, {claim: vi.fn(), release: vi.fn(),},)

		// The reason is pre-selected...
		const reasonCheckbox = container.querySelector<HTMLInputElement>(
			'input[aria-label="Select removal reason 1"]',
		)
		expect(reasonCheckbox?.checked,).toBe(true,)
		// ...the seeded note survives (the auto-fill effect would have cleared it)...
		expect(noteTextInput()?.value,).toBe('seeded note',)
		// ...and the seeded ban duration is not overwritten by a note-type default.
		expect(container.querySelector<HTMLInputElement>('input[type="number"]',)?.value,).toBe('3',)
		// Accept context never offers re-capture.
		expect(
			[...container.querySelectorAll('button',),].some((b,) =>
				b.textContent?.includes('Request second opinion',)
			),
		).toBe(false,)
	})

	it('drops a captured reason that no longer exists, selecting nothing (no throw)', async () => {
		await renderSeeded({
			reasons: [{id: 'gone', text: 'whatever',},],
			reasonType: 'reply',
		}, {claim: vi.fn(), release: vi.fn(),},)

		expect(
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)?.checked,
		).toBe(false,)
	})
})

describe('RemovalReasonsOverlay (accept gate)', () => {
	function renderWithGate (
		acceptGate: RemovalAcceptGate,
		dataOverride: Partial<RemovalReasonsData> = {},
	) {
		act(() => {
			root.render(
				<RemovalReasonsOverlay
					data={{...data, ...dataOverride,}}
					visibleReasons={[reason,]}
					displayMode="Popup"
					settings={settings}
					acceptGate={acceptGate}
					onClose={onClose}
				/>,
			)
		},)
	}

	function selectReasonAndSend () {
		return act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
			getButton('Send',).click()
		},)
	}

	it('aborts the perform and shows the gate message when the claim is rejected', async () => {
		const claim = vi.fn().mockResolvedValue({ok: false, message: 'Already resolved by another moderator',},)
		const release = vi.fn()
		renderWithGate({claim, release,},)

		await selectReasonAndSend()

		expect(claim,).toHaveBeenCalledOnce()
		expect(removeThing,).not.toHaveBeenCalled()
		expect(release,).not.toHaveBeenCalled()
		expect(container.textContent,).toContain('Already resolved by another moderator',)
		expect(onClose,).not.toHaveBeenCalled()
		// Send is re-enabled so the reviewer can retry.
		expect(getButton('Send',).disabled,).toBe(false,)
	})

	it('releases the claim and surfaces an error when the perform returns a failure', async () => {
		removeThing.mockRejectedValueOnce(new Error('nope',),)
		const claim = vi.fn().mockResolvedValue({ok: true,},)
		const release = vi.fn()
		renderWithGate({claim, release,},)

		await selectReasonAndSend()

		expect(claim,).toHaveBeenCalledOnce()
		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(release,).toHaveBeenCalledOnce()
		expect(container.textContent,).toContain('failed to remove item',)
		expect(onClose,).not.toHaveBeenCalled()
		expect(getButton('Send',).disabled,).toBe(false,)
	})

	it('releases the claim and recovers when the perform pipeline throws', async () => {
		// The whole regression: a thrown perform must not leave the overlay stuck or the claim leaked.
		runInReplay.mockRejectedValueOnce(new Error('boom',),)
		const claim = vi.fn().mockResolvedValue({ok: true,},)
		const release = vi.fn()
		renderWithGate({claim, release,},)

		await selectReasonAndSend()

		expect(claim,).toHaveBeenCalledOnce()
		expect(release,).toHaveBeenCalledOnce()
		expect(container.textContent,).toContain('failed to remove item',)
		expect(onClose,).not.toHaveBeenCalled()
		// Not stuck: Send is usable again.
		expect(getButton('Send',).disabled,).toBe(false,)
	})

	it('performs and closes without releasing the claim on success', async () => {
		const claim = vi.fn().mockResolvedValue({ok: true,},)
		const release = vi.fn()
		renderWithGate({claim, release,},)

		await selectReasonAndSend()

		expect(claim,).toHaveBeenCalledOnce()
		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(release,).not.toHaveBeenCalled()
		expect(onClose,).toHaveBeenCalledOnce()
	})

	it('ignores a second concurrent submit (synchronous re-entrancy guard)', async () => {
		const claim = vi.fn().mockResolvedValue({ok: true,},)
		const release = vi.fn()
		renderWithGate({claim, release,},)

		await act(async () => {
			container.querySelector<HTMLInputElement>('input[aria-label="Select removal reason 1"]',)!.click()
			const send = getButton('Send',)
			send.click()
			send.click()
		},)

		// Without the ref guard the second click would pass the still-false `saving` state and
		// claim/perform a second time.
		expect(claim,).toHaveBeenCalledOnce()
		expect(removeThing,).toHaveBeenCalledOnce()
	})
})
