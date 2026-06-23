/** Tests for queue modtools auto-refresh. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

import type {Module,} from '../../../framework/module'
import type {MassModerationSettings,} from '../settings'

const ModtoolsToolbar = vi.hoisted(() => vi.fn(() => null))
const provideLocation = vi.hoisted(() => vi.fn(() => vi.fn()))
const renderAtLocation = vi.hoisted(() =>
	vi.fn((location, _options, render,) => {
		if (location === 'queueToolbar') {
			const element = render({context: {kind: 'queue',}, target: document.createElement('div',),},)
			if (element && typeof element.type === 'function') {
				element.type(element.props,)
			}
		}
		return vi.fn()
	},)
)
const sortThings = vi.hoisted(() => vi.fn())

vi.mock('webextension-polyfill', () => ({
	default: {
		runtime: {sendMessage: vi.fn(),},
		storage: {local: {get: vi.fn().mockResolvedValue({},),},},
	},
}),)
vi.mock('../../../api/resources/modSubs', () => ({
	isModSub: vi.fn().mockResolvedValue(true,),
}),)
vi.mock('../../../api/resources/things', () => ({
	approveThing: vi.fn(),
	ignoreReports: vi.fn(),
	removeThing: vi.fn(),
}),)
vi.mock('../../../util/reddit/pageContext', () => ({
	isMod: true,
	isModpage: true,
	isModQueuePage: true,
	isSubCommentsPage: false,
	isUnmoderatedPage: false,
	postSite: '',
}),)
vi.mock('../components/ModtoolsToolbar', () => ({
	ModtoolsToolbar,
}),)
vi.mock('../../../dom/uiLocations', () => ({
	provideLocation,
	renderAtLocation,
}),)
vi.mock('./queueSorting', async (importOriginal,) => ({
	// Keep the real appendNewItems so the auto-refresh tick actually pins items into the DOM;
	// stub the reorganization functions so we can assert they are not triggered by a tick.
	...(await importOriginal<typeof import('./queueSorting')>()),
	groupBySubreddit: vi.fn(),
	sortThings,
	ungroupBySubreddit: vi.fn(),
}),)
vi.mock('./queueSidebarSorting', () => ({
	createSidebarSortHandlers: () => ({handleSortClick: null,}),
}),)
const formatRelativeTime = vi.hoisted(() => vi.fn((date: Date,) => `relative:${date.toISOString()}`))
vi.mock('../../../util/data/time', async (importOriginal,) => ({
	...(await importOriginal<typeof import('../../../util/data/time')>()),
	formatRelativeTime,
}),)
const updateCounters = vi.hoisted(() => vi.fn())
const getCounterState = vi.hoisted(() =>
	vi.fn(() => ({modqueueCount: 5, unmoderatedCount: 3, modmailCount: 0, modmailCategoryCount: {},}))
)
vi.mock('../../notifier/store', () => ({updateCounters, getCounterState,}),)
const getModuleSettingAsync = vi.hoisted(() => vi.fn().mockResolvedValue(false,))
vi.mock('../../../util/persistence/settings', () => ({getModuleSettingAsync,}),)
const getModLog = vi.hoisted(() => vi.fn().mockResolvedValue({data: {children: [],},},))
vi.mock('../../../api/resources/subreddits', () => ({getModLog,}),)
const negativeTextFeedback = vi.hoisted(() => vi.fn())
vi.mock('../../../store/feedback', () => ({negativeTextFeedback, positiveTextFeedback: vi.fn(),}),)

import {removeThing,} from '../../../api/resources/things'
import {createModtoolsHandlers,} from './queueModtools'

const settings: MassModerationSettings = {
	autoActivate: true,
	hideActionedItems: false,
	groupCommentsOnModPage: false,
	linkToQueues: false,
	reportsThreshold: 0,
	scoreThreshold: 0,
	expandReports: false,
	expandos: false,
	reportsOrder: 'age',
	reportsAscending: false,
	sortLocked: false,
	groupBySubreddit: false,
	autoRefresh: true,
}

describe('queue modtools auto-refresh', () => {
	let autoRefreshTick: (() => Promise<void>) | undefined
	let onActionButton: ((type: string,) => Promise<number>) | undefined

	beforeEach(() => {
		document.body.innerHTML = `
			<div id="siteTable" class="sitetable">
				<div class="thing link" data-fullname="t3_existing" data-subreddit="test">
					<p class="tagline"><time datetime="2026-06-07T10:00:00Z">1 hour ago</time></p>
					<div class="entry"></div>
				</div>
			</div>
		`
		autoRefreshTick = undefined
		onActionButton = undefined
		ModtoolsToolbar.mockImplementation((props,) => {
			autoRefreshTick = props.onAutoRefreshTick
			onActionButton = props.onActionButton
			props.onMount({
				setHiddenCount: vi.fn(),
				setSelectAll: vi.fn(),
				setSelectedCount: vi.fn(),
				triggerAutoRefresh: vi.fn(),
			},)
			return null
		},)
		provideLocation.mockClear()
		renderAtLocation.mockClear()
		sortThings.mockReset()
		getModLog.mockResolvedValue({data: {children: [],},},)
	},)

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.clearAllMocks()
	},)

	it('dispatches TBNewThings after inserting newly fetched queue items', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => `
				<div id="siteTable" class="sitetable">
					<div class="thing link" data-fullname="t3_new" data-subreddit="test">
						<p class="tagline"><time class="live-timestamp" datetime="2026-06-07T11:00:00Z">just now</time></p>
						<div class="entry"></div>
					</div>
					<div class="thing link" data-fullname="t3_existing" data-subreddit="test"></div>
				</div>
			`,
			},),
		)
		const onNewThings = vi.fn()
		window.addEventListener('TBNewThings', onNewThings,)
		try {
			createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)
			// Ignore the resort that runs during initial setup; we only care about the tick.
			sortThings.mockClear()

			await autoRefreshTick?.()

			const inserted = document.querySelector<HTMLElement>('[data-fullname="t3_new"]',)
			expect(inserted,).not.toBeNull()
			expect(inserted?.classList.contains('mte-processed',),).toBe(true,)
			expect(onNewThings,).toHaveBeenCalledOnce()

			// New items are pinned in a bottom "New Items" section, not resorted into the queue.
			const siteTable = document.querySelector('#siteTable',)!
			const section = siteTable.querySelector(':scope > .toolbox-new-items-group',)
			expect(section?.contains(inserted!,),).toBe(true,)
			expect(siteTable.lastElementChild,).toBe(section,)
			expect(sortThings,).not.toHaveBeenCalled()
		} finally {
			window.removeEventListener('TBNewThings', onNewThings,)
		}
	})

	it('recomputes the relative timestamp of inserted items from their datetime attribute', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => `
				<div id="siteTable" class="sitetable">
					<div class="thing link" data-fullname="t3_new" data-subreddit="test">
						<p class="tagline"><time class="live-timestamp" datetime="2026-06-07T11:00:00Z">stale</time></p>
						<div class="entry"></div>
					</div>
					<div class="thing link" data-fullname="t3_existing" data-subreddit="test"></div>
				</div>
			`,
			},),
		)
		createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)

		await autoRefreshTick?.()

		// The inserted item's server-rendered text ('stale') is replaced with a freshly computed
		// relative time derived from the absolute datetime; the original page item is left to Reddit.
		const insertedTime = document.querySelector<HTMLElement>('[data-fullname="t3_new"] time.live-timestamp',)
		expect(formatRelativeTime,).toHaveBeenCalledWith(new Date('2026-06-07T11:00:00Z',),)
		expect(insertedTime?.textContent,).toBe('relative:2026-06-07T11:00:00.000Z',)
		expect(document.querySelector<HTMLElement>('[data-fullname="t3_new"]',)?.classList.contains(
			'toolbox-mm-inserted',
		),).toBe(true,)
	})

	it('refreshes previously inserted timestamps on a later tick that adds no new items', async () => {
		// First tick inserts an item; a stubbed datetime well in the past so we can detect re-compute.
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => `
				<div id="siteTable" class="sitetable">
					<div class="thing link" data-fullname="t3_new" data-subreddit="test">
						<p class="tagline"><time class="live-timestamp" datetime="2026-06-07T11:00:00Z">stale</time></p>
						<div class="entry"></div>
					</div>
					<div class="thing link" data-fullname="t3_existing" data-subreddit="test"></div>
				</div>
			`,
			},),
		)
		createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)
		await autoRefreshTick?.()

		// Subsequent tick returns only already-present items, so nothing new is inserted.
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => `
				<div id="siteTable" class="sitetable">
					<div class="thing link" data-fullname="t3_new" data-subreddit="test"></div>
					<div class="thing link" data-fullname="t3_existing" data-subreddit="test"></div>
				</div>
			`,
			},),
		)
		// Manually stale the inserted timestamp to prove the next tick refreshes it again.
		document.querySelector<HTMLElement>('[data-fullname="t3_new"] time.live-timestamp',)!.textContent = 'frozen'
		formatRelativeTime.mockClear()

		await autoRefreshTick?.()

		expect(formatRelativeTime,).toHaveBeenCalledWith(new Date('2026-06-07T11:00:00Z',),)
		const insertedTime = document.querySelector<HTMLElement>('[data-fullname="t3_new"] time.live-timestamp',)
		expect(insertedTime?.textContent,).toBe('relative:2026-06-07T11:00:00.000Z',)
	})

	/** Waits for the async approveOnIgnore setting fetch (and its `.then`) to settle. */
	async function flushSettings () {
		await new Promise((resolve,) => setTimeout(resolve, 0,))
	}

	function setQueueHtml (action: string,) {
		document.body.innerHTML = `
			<div id="siteTable" class="sitetable">
				<div class="thing link" data-fullname="t3_x" data-subreddit="test">
					<div class="big-mod-buttons"><span>
						<a class="pretty-button neutral" data-event-action="${action}">${action}</a>
					</span></div>
				</div>
			</div>
		`
	}

	it('decrements the modbar modqueue count when an item is approved via a pretty-button', () => {
		setQueueHtml('approve',)
		const handlers = createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)

		handlers.handlePrettyButton(document.querySelector('.pretty-button',)!,)

		expect(updateCounters,).toHaveBeenCalledWith({modqueueCount: 4,},)
	})

	it('does not change the modbar count when ignoring reports without auto-approve', async () => {
		getModuleSettingAsync.mockResolvedValue(false,)
		setQueueHtml('ignorereports',)
		const handlers = createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)
		await flushSettings()

		handlers.handlePrettyButton(document.querySelector('.pretty-button',)!,)

		expect(updateCounters,).not.toHaveBeenCalled()
	})

	it('decrements the modbar count when ignoring reports with auto-approve enabled', async () => {
		getModuleSettingAsync.mockResolvedValue(true,)
		setQueueHtml('ignorereports',)
		const handlers = createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)
		await flushSettings()

		handlers.handlePrettyButton(document.querySelector('.pretty-button',)!,)

		expect(getModuleSettingAsync,).toHaveBeenCalledWith('BetterButtons', 'approveOnIgnore', false,)
		expect(updateCounters,).toHaveBeenCalledWith({modqueueCount: 4,},)
	})

	it('decrements the modbar count by the number of items actioned via the toolbar', async () => {
		document.body.innerHTML = `
			<div id="siteTable" class="sitetable">
				<div class="thing link" data-fullname="t3_a" data-subreddit="test">
					<input type="checkbox" class="toolbox-mm-checkbox" checked>
				</div>
				<div class="thing link" data-fullname="t3_b" data-subreddit="test">
					<input type="checkbox" class="toolbox-mm-checkbox" checked>
				</div>
			</div>
		`
		createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)

		await onActionButton?.('negative',)

		expect(updateCounters,).toHaveBeenCalledWith({modqueueCount: 3,},)
	})

	it('refuses the whole batch and performs no actions when an item\'s subreddit can\'t be resolved', async () => {
		// An item with no data-subreddit on a multi-sub queue (postSite is '' here) can't be
		// proven to be outside a trainee's sandbox, so the batch must be refused outright rather
		// than silently actioning the unlabeled item for real.
		document.body.innerHTML = `
			<div id="siteTable" class="sitetable">
				<div class="thing link" data-fullname="t3_a" data-subreddit="test">
					<input type="checkbox" class="toolbox-mm-checkbox" checked>
				</div>
				<div class="thing link" data-fullname="t3_b">
					<input type="checkbox" class="toolbox-mm-checkbox" checked>
				</div>
			</div>
		`
		createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)

		const actionedCount = await onActionButton?.('negative',)

		expect(actionedCount,).toBe(0,)
		expect(removeThing,).not.toHaveBeenCalled()
		expect(negativeTextFeedback,).toHaveBeenCalled()
		expect(updateCounters,).not.toHaveBeenCalled()
	})

	function setBigModQueueHtml () {
		document.body.innerHTML = `
			<div id="siteTable" class="sitetable">
				<div class="thing link" data-fullname="t3_x" data-subreddit="test">
					<div class="entry">
						<span class="big-mod-buttons"><span role="radiogroup">
							<a class="pretty-button negative" data-event-action="spam">spam</a>
							<a class="pretty-button neutral" data-event-action="remove">remove</a>
							<a class="pretty-button positive" data-event-action="approve">approve</a>
						</span></span>
					</div>
				</div>
			</div>
		`
	}

	it('colors and relabels a queue item removed by another mod, and updates the count', async () => {
		setBigModQueueHtml()
		getModLog.mockResolvedValue({
			data: {children: [{data: {target_fullname: 't3_x', action: 'removelink', mod: 'otheruser',},},],},
		},)
		const handlers = createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)

		await handlers.syncModlogActions()

		const thing = document.querySelector<HTMLElement>('[data-fullname="t3_x"]',)!
		expect(thing.classList.contains('removed',),).toBe(true,)
		expect(thing.classList.contains('toolbox-modlog-actioned',),).toBe(true,)
		// The matching `.neutral` remove button is relabeled in place; the buttons stay clickable.
		const removeButton = document.querySelector('.big-mod-buttons .pretty-button.neutral',)!
		expect(removeButton.textContent,).toBe('Removed by otheruser',)
		expect(removeButton.classList.contains('toolbox-modlog-action-status',),).toBe(true,)
		expect(document.querySelectorAll('.big-mod-buttons .pretty-button',),).toHaveLength(3,)
		expect(updateCounters,).toHaveBeenCalledWith({modqueueCount: 4,},)
	})

	it('marks a spammed item as spammed and an approved item as approved', async () => {
		setBigModQueueHtml()
		getModLog.mockResolvedValue({
			data: {children: [{data: {target_fullname: 't3_x', action: 'spamlink', mod: 'spamcop',},},],},
		},)
		const handlers = createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)

		await handlers.syncModlogActions()

		const thing = document.querySelector<HTMLElement>('[data-fullname="t3_x"]',)!
		expect(thing.classList.contains('spammed',),).toBe(true,)
		// The matching `.negative` spam button is relabeled in place and stays present.
		const spamButton = document.querySelector('.big-mod-buttons .pretty-button.negative',)!
		expect(spamButton.textContent,).toBe('Spammed by spamcop',)
		expect(document.querySelectorAll('.big-mod-buttons .pretty-button',),).toHaveLength(3,)
	})

	it('leaves items absent from the mod log untouched and does not change the count', async () => {
		setBigModQueueHtml()
		getModLog.mockResolvedValue({data: {children: [],},},)
		const handlers = createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)

		await handlers.syncModlogActions()

		const thing = document.querySelector<HTMLElement>('[data-fullname="t3_x"]',)!
		expect(thing.classList.contains('toolbox-modlog-actioned',),).toBe(false,)
		expect(document.querySelector('.big-mod-buttons .pretty-button',),).not.toBeNull()
		expect(updateCounters,).not.toHaveBeenCalled()
	})

	it('does not re-count an item already reconciled on a prior run', async () => {
		setBigModQueueHtml()
		getModLog.mockResolvedValue({
			data: {children: [{data: {target_fullname: 't3_x', action: 'removelink', mod: 'otheruser',},},],},
		},)
		const handlers = createModtoolsHandlers({set: vi.fn(),} as unknown as Module, settings,)

		await handlers.syncModlogActions()
		await handlers.syncModlogActions()

		// The decrement happened only once, on the first reconcile.
		expect(updateCounters,).toHaveBeenCalledTimes(1,)
	})
})
