/** Creates and wires up all mass moderation event handlers for an old Reddit queue page. */

import {createElement,} from 'react'

import {isModSub,} from '../../../api/resources/modSubs'
import {getModLog,} from '../../../api/resources/subreddits'
import {approveThing, ignoreReports, removeThing,} from '../../../api/resources/things'
import {getQueueTabMenu, getSiteTable,} from '../../../dom/oldReddit/page'
import {
	getAllThingCheckboxes,
	getCollapsedExpandButtons,
	getPromotedAndRankEls,
	getThingCheckbox,
	getThingSubredditEl,
	getThingVisibleScoreEl,
	isThingPromotedPost,
} from '../../../dom/oldReddit/queue'
import {
	getReportedStamp,
	getThingBigModButtons,
	getThingFromDescendant,
	getThingFullname,
	getThings,
} from '../../../dom/oldReddit/things'
import {provideLocation, renderAtLocation,} from '../../../dom/uiLocations'
import {createLifecycle,} from '../../../framework/lifecycle'
import {Module,} from '../../../framework/module'
import {betterButtons, massModeration,} from '../../../framework/moduleIds'
import {negativeTextFeedback,} from '../../../store/feedback'
import {formatRelativeTime,} from '../../../util/data/time'
import createLogger from '../../../util/infra/logging'
import {RedditPlatform,} from '../../../util/infra/platform'
import {getModuleSettingAsync,} from '../../../util/persistence/settings'
import {events, sendEvent,} from '../../../util/reddit/events'
import {type ActionFamily, actionFamily,} from '../../../util/reddit/modActions'
import {
	isMod,
	isModpage,
	isModQueuePage,
	isSubCommentsPage,
	isUnmoderatedPage,
	postSite,
} from '../../../util/reddit/pageContext'
import {cleanSubredditName,} from '../../../util/reddit/reddit-domain'
import {notifyNewThings,} from '../../../util/ui/listener'
import {getCounterState, updateCounters,} from '../../notifier/store'
import {isTrainingCaptureActive,} from '../../shared/proposals/gateway'
import {ModtoolsToolbar, type ModtoolsToolbarControls,} from '../components/ModtoolsToolbar'
import type {MassModerationSettings,} from '../settings'
import {createSidebarSortHandlers,} from './queueSidebarSorting'
import {appendNewItems, groupBySubreddit, sortThings, ungroupBySubreddit,} from './queueSorting'

const log = createLogger(massModeration,)

/**
 * Recomputes the relative-time text of native Reddit `live-timestamp` elements under `root` from
 * their absolute `datetime` attribute. Old Reddit caches the set of `live-timestamp` elements at
 * page load, so queue items toolbox inserts later are never refreshed by Reddit and would otherwise
 * freeze at whatever relative text the fetched page was rendered with.
 * @param root Element (e.g. a queue thing) whose descendant timestamps should be refreshed.
 */
function refreshLiveTimestamps (root: ParentNode,) {
	root.querySelectorAll<HTMLTimeElement>('time.live-timestamp[datetime]',).forEach((timeEl,) => {
		const datetime = timeEl.getAttribute('datetime',)
		if (!datetime) { return }
		const date = new Date(datetime,)
		if (Number.isNaN(date.getTime(),)) { return }
		timeEl.textContent = formatRelativeTime(date,)
	},)
}

/**
 * Optimistically decrements the modbar queue counter for the current page after `count` item(s) are
 * actioned (approved/removed/spammed/reports-ignored), so the modbar reflects the change instantly.
 * The notifier's next poll reconciles the exact value. No-op when not on a tracked queue page.
 * @param count Number of items actioned.
 */
function decrementQueueCounter (count: number,) {
	if (count <= 0) { return }
	const state = getCounterState()
	if (isUnmoderatedPage) {
		updateCounters({unmoderatedCount: Math.max(0, state.unmoderatedCount - count,),},)
	} else if (isModQueuePage) {
		updateCounters({modqueueCount: Math.max(0, state.modqueueCount - count,),},)
	}
}

/**
 * Applies the visual treatment for a queue item that was actioned according to the mod log: marks it
 * processed, unchecks it, adds the approval/removal color class, and relabels the matching big-mod
 * action button (approve/remove/spam) to "Approved/Removed/Spammed by <mod>" while leaving it - and
 * its sibling buttons - clickable so the item can still be re-actioned from the queue.
 * @param thing The queue `.thing` element.
 * @param family Whether the logged action was an approval or a removal.
 * @param spam Whether a removal was a spam removal (vs a plain removal).
 * @param mod Username of the moderator who performed the action.
 */
function applyModlogActionToThing (thing: Element, family: ActionFamily, spam: boolean, mod: string,) {
	thing.classList.add('toolbox-modlog-actioned',)
	const cb = getThingCheckbox(thing,)
	if (cb) { cb.checked = false }
	thing.classList.remove('flaired', 'spammed', 'removed', 'approved',)
	thing.classList.add(family === 'approval' ? 'approved' : spam ? 'spammed' : 'removed',)
	const bigMod = getThingBigModButtons(thing,)
	if (bigMod) {
		const verb = family === 'approval' ? 'Approved' : spam ? 'Spammed' : 'Removed'
		const label = `${verb} by ${mod}`
		// The action buttons carry native pretty-button color classes: approve is `.positive`, a plain
		// removal is `.neutral`, and a spam removal is `.negative`. Relabel only the matching one, in
		// place, so it keeps its `data-event-action` and stays clickable alongside its siblings.
		const buttonClass = family === 'approval' ? 'positive' : spam ? 'negative' : 'neutral'
		const button = bigMod.querySelector(`.pretty-button.${buttonClass}`,)
		if (button) {
			button.textContent = label
			button.classList.add('toolbox-modlog-action-status',)
		} else {
			// Unusual DOM (no matching pretty-button): fall back to showing the actioning mod as text so
			// the information isn't lost.
			const status = document.createElement('span',)
			status.className = 'toolbox-modlog-action-status'
			status.textContent = label
			bigMod.append(status,)
		}
	}
}

/**
 * Sets up the "queue tools" tab in the old Reddit tab menu for applicable page types.
 * Performs DOM queries and location provisioning; call `lifecycle.mount(setup.cleanup)` in `index.ts`.
 * @returns `{hasQueueToolsTab, cleanup}` - `hasQueueToolsTab` indicates whether the tab was injected.
 */
export function createMassModerationSetup () {
	const cleanups: Array<() => void> = []
	let hasQueueToolsTab = false

	const body = document.body
	if (
		body.classList.contains('listing-page',) || body.classList.contains('comments-page',)
		|| body.classList.contains('search-page',)
		|| (isModpage && (!postSite || isMod))
	) {
		const tabmenu = getQueueTabMenu()
		if (tabmenu) {
			hasQueueToolsTab = true
			cleanups.push(provideLocation('queueTabControls', tabmenu, {
				platform: RedditPlatform.Old,
				kind: 'queueTab',
				pageType: 'queueListing',
			}, {shadow: false, hostTag: 'li',},),)
			cleanups.push(
				renderAtLocation('queueTabControls', {id: 'massmoderation.queueToolsTab',}, () =>
					createElement('a', {
						accessKey: 'M',
						className: 'toolbox-queue-tools-tab modtools-on',
					}, 'queue tools',),),
			)
		}
	}

	return {
		hasQueueToolsTab,
		cleanup () {
			for (const c of cleanups) { c() }
		},
	}
}

/**
 * Returns a one-shot `activate()` function that calls `createModtoolsHandlers` exactly once.
 * The activated state is held in the factory closure, so `index.ts` needs no guard variable.
 * @returns A function that returns the handler bundle on first call, `null` on subsequent calls.
 */
export function createModtoolsActivator (module: Module<any>, options: MassModerationSettings,) {
	let activated = false
	return function activate () {
		if (activated) { return null }
		activated = true
		return createModtoolsHandlers(module, options,)
	}
}

/**
 * Initializes the Mass Moderation toolbar and queue-level handlers for an old Reddit page.
 * @param module The MassModeration module instance (used to persist settings changes).
 * @returns An object of event handlers to be wired into the module lifecycle.
 */
export function createModtoolsHandlers (
	module: Module<any>,
	{
		hideActionedItems,
		groupCommentsOnModPage,
		linkToQueues,
		reportsThreshold: initialReportsThreshold,
		scoreThreshold: initialScoreThreshold,
		expandReports,
		expandos: initialExpandos,
		reportsOrder,
		reportsAscending,
		sortLocked: initialSortLocked,
		groupBySubreddit: initialGroupBySubreddit,
		autoRefresh: initialAutoRefresh,
	}: MassModerationSettings,
) {
	let listingOrder: string = reportsOrder
	let allSelected = false
	let sortAscending = reportsAscending
	let reportsThreshold = initialReportsThreshold
	let scoreThreshold = initialScoreThreshold
	let sortLocked = initialSortLocked
	let isGroupedBySubreddit = initialGroupBySubreddit
	let contentTypeFilter: 'all' | 'posts' | 'comments' = 'all'
	let controls: ModtoolsToolbarControls | null = null
	const slotCleanups: Array<() => void> = []
	// Owns this factory's timers, the shift-click listener, and the rate_limit restore.
	const lifecycle = createLifecycle()
	// Per-thing cleanups are tracked separately so they don't interleave with the global
	// LIFO drain; each entry is added once per unique thing and held until module teardown.
	const thingCleanups: Array<() => void> = []
	// Index of the last thing the user directly clicked a checkbox on (for shift-click range)
	let lastCheckedIndex = -1
	// Whether Better Buttons auto-approves when ignoring reports. Ignoring reports only resolves a
	// queue item (and so should adjust the modbar count) when this is on. Loaded asynchronously,
	// defaulting to false until it resolves.
	let approveOnIgnore = false
	getModuleSettingAsync(betterButtons, 'approveOnIgnore', false,)
		.then((value,) => {
			approveOnIgnore = value
		},)
		.catch(() => {},)
	// Guards against overlapping mod-log reconciliation fetches when actions fire in quick succession.
	let modlogSyncing = false

	const viewingspam = !!location.pathname.match(/\/about\/(spam|trials)/,)

	if (viewingspam && listingOrder === 'reports') {
		listingOrder = 'removed'
	}

	let queueUrl = ''
	if (linkToQueues) {
		if (isModQueuePage) {
			queueUrl = 'about/modqueue/'
		} else if (isUnmoderatedPage) {
			queueUrl = 'about/unmoderated/'
		}
	}

	getPromotedAndRankEls().forEach((element,) => element.remove())

	function removeUnmoddable () {
		if (!isModpage && !isSubCommentsPage) {
			getThings().forEach(async (thing,) => {
				const subEl = getThingSubredditEl(thing,)
				if (subEl) {
					const sub = cleanSubredditName(subEl.textContent ?? '',)
					const isMod = await isModSub(sub,)
					if (!isMod) { thing.remove() }
				} else if (isThingPromotedPost(thing,)) {
					thing.remove()
				}
			},)
		}
	}

	removeUnmoddable()
	document.body.classList.add('toolbox-mm-active',)

	const modtoolsOnEl = document.querySelector('.modtools-on',)
	modtoolsOnEl?.parentElement?.remove()

	getCollapsedExpandButtons().forEach((element,) => {
		if (
			getComputedStyle(element.closest('.collapsed',)!,).display !== 'none'
			&& element.textContent?.includes('[+]',)
		) {
			;(element as HTMLElement).click()
		}
	},)

	/**
	 * Opens every collapsed expando box on the page, staggered one per second so a long queue
	 * doesn't load all of its media at once. Clicking an expando checks the thing's checkbox on
	 * old Reddit, so each click also re-clears the checkbox.
	 */
	function openAllExpandos (): void {
		document.querySelectorAll('.expando-button.collapsed',).forEach((button, index,) => {
			const checkBox = getThingCheckbox(getThingFromDescendant(button,)!,)
			lifecycle.timeout(() => {
				;(button as HTMLElement).click()
				if (checkBox) { checkBox.checked = false }
			}, index * 1000,)
		},)
	}

	/** Closes every open expando box on the page, re-clearing each thing's checkbox. */
	function closeAllExpandos (): void {
		document.querySelectorAll('.expando-button.expanded',).forEach((button,) => {
			const checkBox = getThingCheckbox(getThingFromDescendant(button,)!,)
			;(button as HTMLElement).click()
			if (checkBox) { checkBox.checked = false }
		},)
	}

	// The expandos setting keeps expando boxes open by default, but Reddit always renders them
	// collapsed; honor the setting here so the toolbar's initial "collapse all" label matches
	// the actual page state.
	if (initialExpandos) {
		openAllExpandos()
	}

	/**
	 * Applies all active hiding rules (report threshold, score threshold,
	 * content-type filter) to a list of things. Clears then re-applies `toolbox-mm-hidden`
	 * so multiple rules compose correctly.
	 */
	function applyHidingRules (thingList: Element[] | NodeListOf<Element>,): void {
		Array.from(thingList,).forEach((thing,) => thing.classList.remove('toolbox-mm-hidden',))
		Array.from(thingList,).forEach((thing,) => {
			const el = thing as HTMLElement
			let hide = false

			// Reports threshold (not applicable on spam queues)
			if (!hide && !viewingspam) {
				const stamp = getReportedStamp(thing,)
				if (stamp) {
					const match = stamp.textContent?.match(/-?\d+/,)
					if (match && parseInt(match[0] ?? '0', 10,) < reportsThreshold) { hide = true }
				} else if (reportsThreshold > 0) {
					hide = true
				}
			}

			// Score threshold - hide items with score strictly above the threshold
			if (!hide && scoreThreshold > 0) {
				const score = parseFloat(getThingVisibleScoreEl(thing,)?.getAttribute('title',) ?? '',)
				if (!isNaN(score,) && score > scoreThreshold) { hide = true }
			}

			// Content-type filter
			if (!hide && contentTypeFilter !== 'all') {
				if (contentTypeFilter === 'posts' && thing.classList.contains('comment',)) { hide = true }
				if (contentTypeFilter === 'comments' && thing.classList.contains('link',)) { hide = true }
			}

			if (hide) { el.classList.add('toolbox-mm-hidden',) }
		},)
	}

	/** Counts all hidden things and pushes the count to the toolbar controls. */
	function syncHiddenCount (): void {
		const count = document.querySelectorAll('.thing.toolbox-mm-hidden',).length
		controls?.setHiddenCount(count,)
	}

	function provideQueueThingSelection (thing: Element,): void {
		if (!thing.matches('.link, .comment',)) { return }
		if (thing.querySelector(':scope > .toolbox-mm-selection-slot',)) { return }

		const slot = document.createElement('span',)
		slot.className = 'toolbox-mm-selection-slot'
		thing.prepend(slot,)

		const thingId = getThingFullname(thing,)
		const cleanupProvider = provideLocation('queueThingSelection', slot, {
			platform: RedditPlatform.Old,
			kind: thing.classList.contains('comment',) ? 'comment' : 'post',
			...(thingId && {thingId,}),
			rawDetail: {thing,},
		}, {shadow: false, hostTag: 'span',},)

		thingCleanups.push(() => {
			cleanupProvider()
			slot.remove()
		},)
	}

	const siteTable = getSiteTable()
	if (siteTable) {
		const toolbarSlot = document.createElement('div',)
		// toolbox-scope activates dark-mode CSS variable overrides (`.toolbox-os-dark .toolbox-scope`)
		toolbarSlot.classList.add('toolbox-scope', 'toolbox-queue-toolbar-slot',)
		siteTable.before(toolbarSlot,)
		slotCleanups.push(() => toolbarSlot.remove())
		slotCleanups.push(provideLocation('queueToolbar', toolbarSlot, {
			platform: RedditPlatform.Old,
			kind: 'queue',
			pageType: 'queueListing',
		}, {shadow: false,},),)
		slotCleanups.push(renderAtLocation('queueToolbar', {id: 'massmoderation.toolbar',}, () => (
			<ModtoolsToolbar
				viewingspam={viewingspam}
				initialSortOrder={listingOrder}
				initialSortAscending={sortAscending}
				initialReportsThreshold={reportsThreshold}
				initialScoreThreshold={scoreThreshold}
				initialExpandReports={expandReports}
				initialExpandosOpen={initialExpandos}
				initialSortLocked={initialSortLocked}
				initialGroupBySubreddit={initialGroupBySubreddit}
				initialAutoRefresh={initialAutoRefresh}
				onMount={(c,) => {
					controls = c
				}}
				onInvert={() => {
					getAllThingCheckboxes().forEach((cb,) => {
						if (getComputedStyle(getThingFromDescendant(cb,)!,).display !== 'none') { cb.click() }
					},)
				}}
				onSelectAll={(checked,) => {
					allSelected = checked
					getAllThingCheckboxes().forEach((cb,) => {
						if (getComputedStyle(getThingFromDescendant(cb,)!,).display !== 'none') { cb.checked = checked }
					},)
					const selected = checked
						? getAllThingCheckboxes().filter((cb,) =>
							getComputedStyle(getThingFromDescendant(cb,)!,).display !== 'none'
						).length
						: 0
					controls?.setSelectedCount(selected,)
				}}
				onHideSelected={() => {
					document.querySelectorAll<HTMLElement>('.thing',).forEach((thing,) => {
						if (getComputedStyle(thing,).display !== 'none' && thing.querySelector('input:checked',)) {
							thing.classList.add('toolbox-mm-hidden',)
						}
					},)
					getAllThingCheckboxes().forEach((cb,) => {
						cb.checked = false
					},)
					syncHiddenCount()
				}}
				onUnhideSelected={() => {
					document.querySelectorAll<HTMLElement>('.thing',).forEach((el,) => {
						el.classList.remove('toolbox-mm-hidden',)
					},)
					syncHiddenCount()
				}}
				onToggleReports={(expanded,) => {
					siteTable?.classList.toggle('toolbox-reports-expanded', expanded,)
				}}
				onActionButton={async (type,) => {
					const approve = type === 'positive'
					const spam = !approve && type === 'negative'
					const ignore = type === 'ignore'
					const actioned = Array.from(
						document.querySelectorAll<HTMLElement>(
							'.thing:not(.toolbox-mm-hidden) .toolbox-mm-checkbox:checked',
						),
					)
						.map((cb,) => cb.closest('.thing',))
						.filter((thing,): thing is HTMLElement => thing instanceof HTMLElement)

					// Mass moderation is a bulk action - not captured in training mode. Refuse
					// the whole batch if the current user is a trainee in any actioned subreddit.
					// Each thing carries its own data-subreddit on multi-sub queues; fall back to
					// the queue's subreddit (postSite) for single-sub queues where it may be absent.
					const actionedSubs = [
						...new Set(
							actioned.map((thing,) => thing.getAttribute('data-subreddit',) || postSite),
						),
					]
					// If any item's subreddit can't be resolved we can't prove the batch is outside
					// a trainee's sandbox, so refuse rather than silently actioning it for real (the
					// previous `.filter(Boolean)` dropped such items from the check entirely).
					if (actionedSubs.some((subreddit,) => !subreddit)) {
						negativeTextFeedback(
							'Couldn\'t determine the subreddit for some items; mass moderation was not performed',
						)
						return 0
					}
					for (const sub of actionedSubs) {
						// eslint-disable-next-line no-await-in-loop
						if (await isTrainingCaptureActive(sub,)) {
							negativeTextFeedback('Mass moderation isn\'t available in training mode',)
							return 0
						}
					}

					await Promise.all(actioned.map((thing,) => {
						const id = getThingFullname(thing,) ?? ''
						if (approve) {
							return approveThing(id,).then(() => sendEvent(events.TB_APPROVE_THING,))
						} else if (ignore) {
							return ignoreReports(id,)
						} else {
							return removeThing(id, spam,)
						}
					},),)

					actioned.forEach((thing,) => {
						thing.classList.remove('flaired', 'spammed', 'removed', 'approved',)
						thing.classList.add(approve ? 'approved' : spam ? 'spammed' : 'removed',)
						if (hideActionedItems) { thing.classList.add('toolbox-mm-hidden',) }
					},)
					if (hideActionedItems) { syncHiddenCount() }
					// Ignoring reports only resolves items out of the queue when auto-approve on ignore
					// is enabled; approve/remove/spam always do.
					if (!ignore || approveOnIgnore) {
						// Mark as counted so the mod-log reconcile below doesn't decrement them again.
						actioned.forEach((thing,) => thing.classList.add('toolbox-modlog-actioned',))
						decrementQueueCounter(actioned.length,)
					}
					// Reconcile other items with the mod log (e.g. actioned by another mod meanwhile).
					void syncModlogActions()

					return actioned.length
				}}
				onThresholdChange={(threshold,) => {
					reportsThreshold = threshold
					module.set('reportsThreshold', threshold,)
					applyHidingRules(getThings(),)
				}}
				onScoreThresholdChange={(threshold,) => {
					scoreThreshold = threshold
					module.set('scoreThreshold', threshold,)
					applyHidingRules(getThings(),)
				}}
				onSortChoice={(order, toggleAsc,) => {
					if (toggleAsc) { sortAscending = !sortAscending }
					module.set('reportsAscending', sortAscending,)
					module.set('reportsOrder', order,)
					listingOrder = order
					if (!sortLocked) {
						sortThings(order, sortAscending, groupCommentsOnModPage,)
						if (isGroupedBySubreddit && siteTable) {
							groupBySubreddit(siteTable,)
						}
					}
				}}
				onSortLockChange={(locked,) => {
					sortLocked = locked
					module.set('sortLocked', locked,)
				}}
				onOpenExpandos={(open,) => {
					if (open) {
						openAllExpandos()
					} else {
						closeAllExpandos()
					}
					module.set('expandos', open,)
				}}
				onGroupBySubreddit={(enabled,) => {
					isGroupedBySubreddit = enabled
					if (!siteTable) { return }
					if (enabled) {
						groupBySubreddit(siteTable,)
					} else {
						ungroupBySubreddit(siteTable,)
					}
				}}
				onAutoRefreshChange={(enabled,) => {
					module.set('autoRefresh', enabled,)
				}}
				onContentTypeFilter={(type,) => {
					contentTypeFilter = type
					applyHidingRules(getThings(),)
					syncHiddenCount()
				}}
				onAutoRefreshTick={async () => {
					log.debug('auto-refresh tick',)

					// Old Reddit never updates the timestamps of items toolbox inserted, so refresh
					// them ourselves every tick - otherwise their relative times freeze at insertion.
					if (siteTable) {
						siteTable.querySelectorAll('.toolbox-mm-inserted',).forEach(refreshLiveTimestamps,)
					}

					// Reconcile the queue with actions taken elsewhere (other mods, or this user on
					// another queue page); a newly reconciled item counts as "something new" for backoff.
					const modlogResolved = await syncModlogActions()

					// Fetch the current queue page to discover items that arrived since last load
					let newThings: Element[] = []
					try {
						const response = await fetch(location.href,)
						if (response.ok) {
							const fetchedDoc = new DOMParser().parseFromString(await response.text(), 'text/html',)
							const existingFullnames = new Set(
								getThings().map((t,) => t.getAttribute('data-fullname',)).filter(Boolean,),
							)
							newThings = Array.from(
								fetchedDoc.querySelectorAll('.sitetable > .thing',),
							).filter((t,) => {
								const fullname = t.getAttribute('data-fullname',)
								return fullname && !existingFullnames.has(fullname,)
							},)
						}
					} catch {
						// Ignore fetch errors; fall through with no new items.
					}

					if (newThings.length > 0) {
						// Pin new items to the bottom of the queue under a "New Items" header, below any
						// subreddit groups. They deliberately stay here - not resorted into place - until
						// the user triggers a resort, which dissolves the section (see sortThings).
						if (siteTable) {
							appendNewItems(siteTable, newThings,)
						}
						processNewThings(newThings,)
						notifyNewThings()
						syncHiddenCount()
					}

					// Found a new item or a new mod-log action -> caller resets the backoff interval.
					return newThings.length > 0 || modlogResolved > 0
				}}
			/>
		),),)
	}

	// Shift-click range selection: intercept checkbox clicks on the site table
	const handleShiftClick = (event: Event,) => {
		const e = event as MouseEvent
		const target = e.target as HTMLElement
		if (!target.classList.contains('toolbox-mm-checkbox',)) { return }

		const thing = target.closest<HTMLElement>('.thing',)
		if (!thing) { return }

		const allThings = Array.from(getThings(),)
		const currentIndex = allThings.indexOf(thing,)

		if (e.shiftKey && lastCheckedIndex >= 0 && currentIndex >= 0 && currentIndex !== lastCheckedIndex) {
			// target.checked is already the post-click state when the click event fires
			const checked = (target as HTMLInputElement).checked
			const start = Math.min(lastCheckedIndex, currentIndex,)
			const end = Math.max(lastCheckedIndex, currentIndex,)
			allThings.slice(start, end + 1,).forEach((t,) => {
				if (t === thing) { return } // browser already set this one
				const cb = getThingCheckbox(t,)
				if (cb && getComputedStyle(t,).display !== 'none') { cb.checked = checked }
			},)
			syncSelectionState()
		}

		if (currentIndex >= 0) { lastCheckedIndex = currentIndex }
	}
	if (siteTable) { lifecycle.on(siteTable, 'click', handleShiftClick,) }

	const things = getThings()
	things.forEach((element,) => element.classList.add('mte-processed',))

	if (expandReports) { siteTable?.classList.add('toolbox-reports-expanded',) }

	function replaceSubLinks (element: Element,) {
		const subLink = element.querySelector('a.subreddit',)
		if (subLink) {
			const href = subLink.getAttribute('href',)
			if (href) { subLink.setAttribute('href', href + queueUrl,) }
		}
	}

	if (linkToQueues && queueUrl) {
		Array.from(things,).forEach((element,) => replaceSubLinks(element,))
	}

	if (!viewingspam) {
		applyHidingRules(things,)
	}

	slotCleanups.push(renderAtLocation('queueThingSelection', {id: 'massmoderation.selection',}, ({context,},) => {
		if (context.kind !== 'post' && context.kind !== 'comment') { return null }
		return <input type="checkbox" className="toolbox-mm-checkbox" tabIndex={1} defaultChecked={allSelected} />
	},),)
	getThings().filter((t,) => t.matches('.link, .comment',)).forEach((thing,) => provideQueueThingSelection(thing,))
	document.querySelectorAll('.buttons .pretty-button',).forEach((element,) => element.setAttribute('tabindex', '2',))

	const origRateLimit = (window as any).rate_limit
	;(window as any).rate_limit = function (action: string,) {
		if (action === 'expando' || action === 'remove' || action === 'approve') { return false }
		return origRateLimit(action,)
	}
	lifecycle.mount(() => {
		;(window as any).rate_limit = origRateLimit
	},)

	const sidebarSort = createSidebarSortHandlers()
	sortThings(listingOrder, sortAscending, groupCommentsOnModPage,)
	if (initialGroupBySubreddit && siteTable) {
		groupBySubreddit(siteTable,)
	}

	/**
	 * Recalculates and broadcasts current selection state to the toolbar controls.
	 * Call after any programmatic checkbox change (shift-click, select-same-sub).
	 */
	function syncSelectionState () {
		const checks = getAllThingCheckboxes().filter((cb,) =>
			getComputedStyle(getThingFromDescendant(cb,)!,).display !== 'none'
		)
		allSelected = checks.every((cb,) => cb.checked)
		const selected = checks.filter((cb,) => cb.checked).length
		controls?.setSelectAll(allSelected, !!selected && !allSelected,)
		controls?.setSelectedCount(selected,)
	}

	/**
	 * Fetches the recent moderation log and reconciles the queue with actions taken elsewhere - by
	 * other mods, or by this user on another queue page. Each queue item already approved/removed/
	 * spammed gets the matching color, its action buttons replaced with an "Approved/Removed by <mod>"
	 * status, and the modbar count decremented. Items already actioned locally (or reconciled on a
	 * previous run) carry the `toolbox-modlog-actioned` marker and are skipped so each counts once.
	 * @returns The number of items newly reconciled on this run (0 if the fetch is skipped or fails).
	 */
	async function syncModlogActions (): Promise<number> {
		if (modlogSyncing) { return 0 }
		modlogSyncing = true
		let resolved = 0
		try {
			let response: any
			try {
				// postSite is the queue's subreddit, or '' on multi-sub queues - fall back to `mod`.
				response = await getModLog(postSite || 'mod', {limit: '100', raw_json: '1',},)
			} catch {
				return 0
			}

			// Mod log is newest-first; keep only the most recent resolving action per target.
			const actionsByFullname = new Map<string, {family: ActionFamily; spam: boolean; mod: string}>()
			for (const child of response?.data?.children ?? []) {
				const data = child?.data
				const fullname: string | undefined = data?.target_fullname
				if (!fullname || actionsByFullname.has(fullname,)) { continue }
				const family = actionFamily[data.action]
				if (family !== 'approval' && family !== 'remove') { continue }
				actionsByFullname.set(fullname, {
					family,
					spam: data.action === 'spamlink' || data.action === 'spamcomment',
					mod: data.mod ?? '',
				},)
			}

			getThings().forEach((thing,) => {
				if (thing.classList.contains('toolbox-modlog-actioned',)) { return }
				const fullname = getThingFullname(thing,)
				if (!fullname) { return }
				const entry = actionsByFullname.get(fullname,)
				if (!entry) { return }
				applyModlogActionToThing(thing, entry.family, entry.spam, entry.mod,)
				resolved += 1
			},)
			if (resolved > 0) { decrementQueueCounter(resolved,) }
		} finally {
			modlogSyncing = false
		}
		return resolved
	}

	function processNewThings (newThings: NodeListOf<Element> | Element[],) {
		const thingsArr = Array.from(newThings,)
		thingsArr.forEach((thing,) => {
			thing.classList.add('mte-processed',)
			// Mark items toolbox inserted so the auto-refresh tick can keep their relative timestamps
			// current - Old Reddit's own updater never sees dynamically added items. Refresh once now
			// so the timestamp is correct the moment the item appears.
			thing.classList.add('toolbox-mm-inserted',)
			refreshLiveTimestamps(thing,)
			// Highlight newly loaded items with a fade animation (see massmoderation.css)
			thing.classList.add('toolbox-mm-new',)
			thing.addEventListener('animationend', () => thing.classList.remove('toolbox-mm-new',), {once: true,},)
		},)
		thingsArr.forEach((thing,) => {
			provideQueueThingSelection(thing,)
			thing.querySelectorAll('.collapsed a.expand',).forEach((element,) => {
				if (
					getComputedStyle(element.closest('.collapsed',)!,).display !== 'none'
					&& element.textContent?.includes('[+]',)
				) {
					;(element as HTMLElement).click()
				}
			},)
			thing.querySelectorAll('.userattrs.comment .flat-list.buttons',).forEach((list,) => {
				const hasParentLink = Array.from(list.querySelectorAll('a',),).some((a,) => a.textContent === 'parent')
				if (hasParentLink) {
					const bylink = list.querySelector('.first .bylink',)
					if (bylink) {
						const li = document.createElement('li',)
						li.className = 'toolbox-replacement'
						const a = document.createElement('a',)
						a.className = 'context'
						a.href = `${bylink.getAttribute('href',)}?context=2`
						a.textContent = 'context'
						li.appendChild(a,)
						list.insertAdjacentElement('afterbegin', li,)
					}
				}
			},)
		},)
		applyHidingRules(thingsArr,)
		if (linkToQueues && queueUrl) { thingsArr.forEach((element,) => replaceSubLinks(element,)) }
		removeUnmoddable()
	}

	return {
		sidebarSort,
		cleanup: () => {
			while (thingCleanups.length) {
				thingCleanups.pop()!()
			}
			while (slotCleanups.length) {
				slotCleanups.pop()!()
			}
			return lifecycle.cleanup()
		},

		/** Processes any newly-added queue items that haven't been seen yet. */
		handleNewThings () {
			log.debug('proc new things',)
			const newThings = getThings().filter((t,) => !t.classList.contains('mte-processed',))
			processNewThings(newThings,)
		},

		/** Reconciles the queue with the recent mod log (actions by other mods, or yourself elsewhere). */
		syncModlogActions,

		/** Selects the item when the user clicks anywhere on a thing's entry row. */
		handleThingEntry (entryEl: Element, event: MouseEvent,) {
			if ((event.target as Element).closest('a, button, input, textarea, img',)) { return }
			if ((event.target as Element).classList?.contains('toolbox-react-shadow-host',)) { return }
			log.debug('thing selected.',)
			getThingCheckbox(getThingFromDescendant(entryEl,)!,)?.click()
		},

		/** Selects the item when the user clicks its reported-stamp. */
		handleReportedStamp (stampEl: Element,) {
			log.debug('reports selected.',)
			getThingCheckbox(getThingFromDescendant(stampEl,)!,)?.click()
		},

		/** Syncs toolbar selection state when any checkbox changes. */
		handleThingCheckbox () {
			syncSelectionState()
		},

		/** Hides or marks items after a per-item pretty-button action. */
		handlePrettyButton (button: Element,) {
			const thing = button.closest<HTMLElement>('.thing',)
			if (!thing) { return }
			const cb = getThingCheckbox(thing,)
			if (cb) { cb.checked = false }
			// A user action polls immediately so the queue reconciles without waiting out the countdown.
			controls?.triggerAutoRefresh()
			// Approve/remove/spam always resolve the item out of the queue; ignoring reports only does
			// so when Better Buttons is set to auto-approve on ignore. Reflect resolutions in the
			// modbar count immediately.
			const action = button.getAttribute('data-event-action',)
			const resolvesItem = action === 'approve' || action === 'remove' || action === 'spam'
				|| (action === 'ignorereports' && approveOnIgnore)
			if (resolvesItem) {
				// Mark as counted so the mod-log reconcile below doesn't decrement it a second time.
				thing.classList.add('toolbox-modlog-actioned',)
				decrementQueueCounter(1,)
			}
			// Reconcile other items with the mod log (e.g. actioned by another mod meanwhile).
			void syncModlogActions()
			if (hideActionedItems) {
				log.debug('hiding item',)
				thing.classList.add('toolbox-mm-hidden',)
			} else if (button.classList.contains('negative',)) {
				thing.classList.remove('removed', 'approved',)
				thing.classList.add('spammed',)
			} else if (button.classList.contains('neutral',)) {
				thing.classList.remove('spammed', 'approved',)
				thing.classList.add('removed',)
			} else if (button.classList.contains('positive',)) {
				thing.classList.remove('removed', 'spammed',)
				thing.classList.add('approved',)
			}
		},
	}
}

/** The handler bundle returned by {@link createModtoolsHandlers}. */
export type ModtoolsHandlers = ReturnType<typeof createModtoolsHandlers>
