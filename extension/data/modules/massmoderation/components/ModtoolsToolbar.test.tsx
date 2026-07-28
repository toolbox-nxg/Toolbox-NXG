/** Tests for ModtoolsToolbar auto-refresh backoff and selection-control stability. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {
		runtime: {sendMessage: vi.fn(), getURL: vi.fn((path: string,) => path),},
		storage: {local: {get: vi.fn().mockResolvedValue({},),},},
	},
}),)

import {ModtoolsToolbar, type ModtoolsToolbarControls, type ModtoolsToolbarProps,} from './ModtoolsToolbar'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

/** Builds a full set of ModtoolsToolbar props, with no-op callbacks unless overridden. */
function defaultProps (overrides: Partial<ModtoolsToolbarProps>,): ModtoolsToolbarProps {
	return {
		viewingspam: false,
		initialSortOrder: 'age',
		initialSortAscending: false,
		initialReportsThreshold: 0,
		initialScoreThreshold: 0,
		initialExpandReports: false,
		initialExpandosOpen: false,
		initialSortLocked: false,
		initialGroupBySubreddit: false,
		initialAutoRefresh: true,
		onMount: vi.fn(),
		onInvert: vi.fn(),
		onSelectAll: vi.fn(),
		onHideSelected: vi.fn(),
		onUnhideSelected: vi.fn(),
		onToggleReports: vi.fn(),
		onActionButton: vi.fn().mockResolvedValue(0,),
		onThresholdChange: vi.fn(),
		onScoreThresholdChange: vi.fn(),
		onSortChoice: vi.fn(),
		onSortLockChange: vi.fn(),
		onOpenExpandos: vi.fn(),
		onGroupBySubreddit: vi.fn(),
		onAutoRefreshChange: vi.fn(),
		onAutoRefreshTick: vi.fn().mockResolvedValue(false,),
		onContentTypeFilter: vi.fn(),
		...overrides,
	}
}

function renderToolbar (overrides: Partial<ModtoolsToolbarProps>,) {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	act(() => {
		root.render(<ModtoolsToolbar {...defaultProps(overrides,)} />,)
	},)
	return host
}

/**
 * Finds a rendered button by its exact label. Queries by text rather than CSS-module class,
 * because vitest runs with `css: false` so the hashed class names are not real.
 * @param label The button's trimmed text content.
 */
function buttonByText (label: string,): HTMLButtonElement {
	const button = Array.from(document.querySelectorAll('button',),)
		.find((element,) => element.textContent?.trim() === label)
	if (!button) { throw new Error(`no button labelled "${label}"`,) }
	return button
}

/** Advances fake timers (and flushes the async tick) inside an act() boundary. */
async function advance (ms: number,) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms,)
	},)
}

describe('ModtoolsToolbar auto-refresh backoff', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	},)

	afterEach(() => {
		act(() => {
			roots.forEach((root,) => root.unmount())
		},)
		roots.length = 0
		document.body.innerHTML = ''
		vi.useRealTimers()
	},)

	it('starts at 5s and doubles the interval each time a tick finds nothing new', async () => {
		const onAutoRefreshTick = vi.fn<() => Promise<boolean>>().mockResolvedValue(false,)
		renderToolbar({onAutoRefreshTick,},)

		// First poll fires after the 5s minimum interval.
		await advance(5000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(1,)

		// Nothing new → interval doubled to 10s: no fire at +9s, fires at +10s.
		await advance(9000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(1,)
		await advance(1000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(2,)

		// Doubled again to 20s.
		await advance(20000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(3,)
	})

	it('caps the interval at 60s', async () => {
		const onAutoRefreshTick = vi.fn<() => Promise<boolean>>().mockResolvedValue(false,)
		renderToolbar({onAutoRefreshTick,},)

		// 5 + 10 + 20 + 40 = 75s reaches the cap after four polls.
		await advance(75000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(4,)

		// Interval is now capped at 60s (not 80): nothing at +59s, fire at +60s.
		await advance(59000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(4,)
		await advance(1000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(5,)
	})

	it('snaps back to 5s when a tick finds something new', async () => {
		const onAutoRefreshTick = vi.fn<() => Promise<boolean>>().mockResolvedValue(false,)
		renderToolbar({onAutoRefreshTick,},)

		await advance(5000,) // fire 1 → interval 10s
		await advance(10000,) // fire 2 → interval 20s
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(2,)

		// Next poll reports something new → interval resets to 5s.
		onAutoRefreshTick.mockResolvedValue(true,)
		await advance(20000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(3,)
		await advance(5000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(4,)
	})

	it('polls immediately and resets the backoff when triggerAutoRefresh is invoked', async () => {
		const onAutoRefreshTick = vi.fn<() => Promise<boolean>>().mockResolvedValue(false,)
		let controls: ModtoolsToolbarControls | undefined
		renderToolbar({
			onAutoRefreshTick,
			onMount: (c,) => {
				controls = c
			},
		},)

		await advance(5000,) // fire 1 → interval 10s
		await advance(10000,) // fire 2 → interval 20s
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(2,)

		// A user action polls immediately instead of waiting out the (20s) countdown.
		await act(async () => {
			controls!.triggerAutoRefresh()
			await vi.advanceTimersByTimeAsync(0,)
		},)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(3,)

		// That immediate poll found nothing, so the backoff resumes from the minimum (next fire +10s).
		await advance(9000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(3,)
		await advance(1000,)
		expect(onAutoRefreshTick,).toHaveBeenCalledTimes(4,)
	})
})

describe('ModtoolsToolbar selection controls', () => {
	/** Every control whose enabled state depends on the current selection. */
	const bulkLabels = [
		'invert',
		'unhide all',
		'hide selected',
		'spam selected',
		'remove selected',
		'approve selected',
		'ignore reports on selected',
	]

	afterEach(() => {
		act(() => {
			roots.forEach((root,) => root.unmount())
		},)
		roots.length = 0
		document.body.innerHTML = ''
	},)

	/** Renders a toolbar with auto-refresh off and returns its host plus imperative controls. */
	function renderIdle () {
		let controls: ModtoolsToolbarControls | undefined
		const host = renderToolbar({
			initialAutoRefresh: false,
			onMount: (c,) => {
				controls = c
			},
		},)
		return {host, controls: controls!,}
	}

	it('renders every bulk control before anything is selected', () => {
		renderIdle()

		// The layout-stability guarantee: these used to mount on first selection, which grew the
		// toolbar by a flex row and pushed the queue down under the user's cursor mid-click.
		for (const label of bulkLabels) {
			expect(() => buttonByText(label,)).not.toThrow()
		}
	})

	it('mounts and unmounts nothing as the selection changes', () => {
		const {host, controls,} = renderIdle()
		const idleButtons = host.querySelectorAll('button',).length

		// A single checked item leaves select-all indeterminate - the exact case from the bug report.
		act(() => {
			controls.setSelectAll(false, true,)
			controls.setSelectedCount(1,)
		},)
		expect(host.querySelectorAll('button',).length,).toBe(idleButtons,)

		act(() => {
			controls.setSelectAll(true, false,)
			controls.setSelectedCount(3,)
		},)
		expect(host.querySelectorAll('button',).length,).toBe(idleButtons,)
	})

	it('disables every bulk control while nothing is selected', () => {
		renderIdle()

		for (const label of bulkLabels) {
			expect(buttonByText(label,).disabled,).toBe(true,)
		}
	})

	it('enables the selection-dependent controls once items are selected', () => {
		const {controls,} = renderIdle()

		act(() => {
			controls.setSelectAll(true, false,)
			controls.setSelectedCount(2,)
		},)

		expect(buttonByText('hide selected',).disabled,).toBe(false,)
		expect(buttonByText('spam selected',).disabled,).toBe(false,)
		expect(buttonByText('remove selected',).disabled,).toBe(false,)
		expect(buttonByText('approve selected',).disabled,).toBe(false,)
		expect(buttonByText('ignore reports on selected',).disabled,).toBe(false,)
		expect(document.body.textContent,).toContain('2 selected',)
		// Nothing is hidden, so unhide stays inert.
		expect(buttonByText('unhide all',).disabled,).toBe(true,)
	})

	it('enables unhide all only once items are hidden', () => {
		const {controls,} = renderIdle()

		act(() => {
			controls.setHiddenCount(3,)
		},)

		expect(buttonByText('unhide all',).disabled,).toBe(false,)
		expect(buttonByText('spam selected',).disabled,).toBe(true,)
	})

	it('ignores a bulk action fired against an empty selection', () => {
		const onActionButton = vi.fn<(type: string,) => Promise<number>>().mockResolvedValue(0,)
		let controls: ModtoolsToolbarControls | undefined
		renderToolbar({
			initialAutoRefresh: false,
			onActionButton,
			onMount: (c,) => {
				controls = c
			},
		},)

		// `disabled` is what stops this; handleActionClick's own !anySelected check is defence in
		// depth for the accessKey path and is not reachable from here. The invariant is what matters.
		act(() => {
			buttonByText('spam selected',).dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
		},)
		expect(onActionButton,).not.toHaveBeenCalled()

		act(() => {
			controls!.setSelectAll(true, false,)
			controls!.setSelectedCount(1,)
		},)
		act(() => {
			buttonByText('spam selected',).dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
		},)
		expect(onActionButton,).toHaveBeenCalledWith('negative',)
	})
})
