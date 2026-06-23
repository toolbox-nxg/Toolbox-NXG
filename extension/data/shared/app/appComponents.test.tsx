/** Tests for ErrorBoundary. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const logError = vi.hoisted(() => vi.fn())
let selectorState = vi.hoisted(() => ({
	spinner: {count: 0,},
	textFeedback: {current: null as {message: string; kind: TextFeedbackKind} | null,},
}))
let settingValue = vi.hoisted(() => 'left' as 'left' | 'right' | '')
const runtime = vi.hoisted(() => ({
	onMessage: {addListener: vi.fn(), removeListener: vi.fn(),},
	sendMessage: vi.fn(),
}))

vi.mock('../../util/infra/logging', () => ({default: () => ({error: logError,}),}),)
vi.mock('../../util/ui/reactMount', () => ({
	classes: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean,).join(' ',),
}),)
vi.mock('react-redux', () => ({
	useSelector: (selector: (state: typeof selectorState,) => unknown,) => selector(selectorState,),
}),)
vi.mock('framer-motion', () => ({
	AnimatePresence: ({children,}: {children: React.ReactNode},) => <>{children}</>,
	motion: {div: (props: React.ComponentProps<'div'>,) => <div {...props} />,},
}),)
vi.mock('webextension-polyfill', () => ({default: {runtime,},}),)
vi.mock('../../util/ui/hooks', () => ({useSetting: () => settingValue,}),)
vi.mock('../../modules/announcements/components/AnnouncementCard', () => ({
	AnnouncementCard: ({note, onClose,}: {
		note: {title: string; body: string}
		onClose?: () => void
	},) => (
		<div data-title={note.title}>
			<h2>{note.title}</h2>
			<button
				type="button"
				aria-label="close"
				onClick={(event,) => {
					event.stopPropagation()
					onClose?.()
				}}
			>
				close
			</button>
			<p>{note.body}</p>
		</div>
	),
}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {TextFeedbackKind,} from '../../store/textFeedbackSlice'
import {ErrorBoundary,} from './ErrorBoundary'
import {PageNotificationContainer,} from './PageNotificationContainer'
import {SpinnerContainer,} from './SpinnerContainer'
import {TextFeedbackContainer,} from './TextFeedbackContainer'

const roots: Root[] = []

function render (ui: React.ReactNode,): HTMLElement {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	act(() => {
		root.render(ui,)
	},)
	return host
}

function listener () {
	return runtime.onMessage.addListener.mock.calls[0]![0] as (message: unknown,) => undefined
}

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
	vi.restoreAllMocks()
},)

beforeEach(() => {
	selectorState = {spinner: {count: 0,}, textFeedback: {current: null,},}
	settingValue = 'left'
	logError.mockClear()
	runtime.onMessage.addListener.mockClear()
	runtime.onMessage.removeListener.mockClear()
	runtime.sendMessage.mockReset().mockResolvedValue(undefined,)
},)

describe('ErrorBoundary', () => {
	it('renders children normally', () => {
		const host = render(
			<ErrorBoundary name="Test">
				<span>safe</span>
			</ErrorBoundary>,
		)

		expect(host.textContent,).toBe('safe',)
	})

	it('renders default fallback and logs render errors', () => {
		const consoleError = vi.spyOn(console, 'error',).mockImplementation(() => {},)
		const Broken = () => {
			throw new Error('boom',)
		}

		const host = render(
			<ErrorBoundary name="Shared">
				<Broken />
			</ErrorBoundary>,
		)

		expect(host.textContent,).toBe('[TB error in Shared]',)
		expect(host.querySelector('span',)?.title,).toBe('boom',)
		expect(logError,).toHaveBeenCalledWith(
			'[Shared] React render error:',
			expect.any(Error,),
			expect.any(String,),
		)
		consoleError.mockRestore()
	})

	it('renders custom fallback when provided', () => {
		const consoleError = vi.spyOn(console, 'error',).mockImplementation(() => {},)
		const Broken = () => {
			throw new Error('boom',)
		}

		const host = render(
			<ErrorBoundary fallback={<strong>custom</strong>}>
				<Broken />
			</ErrorBoundary>,
		)

		expect(host.textContent,).toBe('custom',)
		consoleError.mockRestore()
	})
})

describe('shared app display containers', () => {
	it('shows spinner only when spinner count is positive', () => {
		expect(render(<SpinnerContainer />,).textContent,).toBe('',)

		selectorState = {...selectorState, spinner: {count: 2,},}
		const host = render(<SpinnerContainer />,)

		expect(host.textContent,).toContain('Loading',)
	})

	it('registers a beforeunload guard only while the spinner is visible', () => {
		const addSpy = vi.spyOn(window, 'addEventListener',)
		const removeSpy = vi.spyOn(window, 'removeEventListener',)

		// Count is zero: no guard should be registered.
		const idleHost = document.createElement('div',)
		document.body.appendChild(idleHost,)
		const idleRoot = createRoot(idleHost,)
		roots.push(idleRoot,)
		act(() => idleRoot.render(<SpinnerContainer />,))
		expect(addSpy.mock.calls.some(([type,],) => type === 'beforeunload'),).toBe(false,)

		// Count is positive: the guard is registered on mount.
		selectorState = {...selectorState, spinner: {count: 1,},}
		const busyHost = document.createElement('div',)
		document.body.appendChild(busyHost,)
		const busyRoot = createRoot(busyHost,)
		act(() => busyRoot.render(<SpinnerContainer />,))
		expect(addSpy.mock.calls.some(([type,],) => type === 'beforeunload'),).toBe(true,)

		// Unmounting tears the guard back down.
		act(() => busyRoot.unmount())
		expect(removeSpy.mock.calls.some(([type,],) => type === 'beforeunload'),).toBe(true,)
	})

	it('shows current text feedback when present', () => {
		selectorState = {
			...selectorState,
			textFeedback: {
				current: {
					message: 'Saved',
					kind: TextFeedbackKind.Positive,
				},
			},
		}
		const host = render(<TextFeedbackContainer />,)

		expect(host.textContent,).toBe('Saved',)
	})
})

describe('PageNotificationContainer', () => {
	it('registers and removes the runtime message listener', () => {
		render(<PageNotificationContainer />,)

		expect(runtime.onMessage.addListener,).toHaveBeenCalledWith(expect.any(Function,),)

		act(() => roots.pop()!.unmount())

		expect(runtime.onMessage.removeListener,).toHaveBeenCalledWith(expect.any(Function,),)
	})

	it('renders incoming notifications with the body in a single card paragraph', () => {
		const host = render(<PageNotificationContainer />,)

		act(() => {
			listener()({
				action: 'toolbox-show-page-notification',
				details: {id: 'one', title: 'Title', body: 'Line one\n\nLine two',},
			},)
		},)

		expect(host.textContent,).toContain('Title',)
		// The card renders the body as one paragraph; line breaks are preserved via CSS.
		const paragraphs = Array.from(host.querySelectorAll('p',),)
		expect(paragraphs,).toHaveLength(1,)
		expect(paragraphs[0]!.textContent,).toBe('Line one\n\nLine two',)
	})

	it('notifies the background when notifications are clicked or closed', () => {
		const host = render(<PageNotificationContainer />,)
		act(() => {
			listener()({
				action: 'toolbox-show-page-notification',
				details: {id: 'one', title: 'Title', body: 'Body',},
			},)
		},)

		act(() => {
			// The clickable wrapper is the card's parent element.
			host.querySelector('[data-title]',)!.parentElement!.dispatchEvent(
				new MouseEvent('click', {bubbles: true,},),
			)
		},)
		expect(runtime.sendMessage,).toHaveBeenCalledWith({action: 'toolbox-page-notification-click', id: 'one',},)

		act(() => {
			host.querySelector('button[aria-label="close"]',)!.dispatchEvent(
				new MouseEvent('click', {bubbles: true,},),
			)
		},)
		expect(runtime.sendMessage,).toHaveBeenCalledWith({action: 'toolbox-page-notification-clear', id: 'one',},)
		expect(host.textContent,).not.toContain('Title',)
	})

	it('clears notifications when the background broadcasts a clear message', () => {
		const host = render(<PageNotificationContainer />,)
		act(() => {
			listener()({
				action: 'toolbox-show-page-notification',
				details: {id: 'one', title: 'Title', body: 'Body',},
			},)
			listener()({action: 'toolbox-clear-page-notification', id: 'one',},)
		},)

		expect(host.textContent,).not.toContain('Title',)
	})

	it('renders nothing when context menu location setting is unavailable', () => {
		settingValue = ''

		const host = render(<PageNotificationContainer />,)

		expect(host.textContent,).toBe('',)
	})
})
