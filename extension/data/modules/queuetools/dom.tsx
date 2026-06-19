/** DOM integration for the Queue Tools module - renders mod action tables, ignored-report buttons, and the queue creature. */
import {isModSub,} from '../../api/resources/modSubs'
import {getModLog,} from '../../api/resources/subreddits'
import {getInfo,} from '../../api/resources/things'
import {getQueueEmptyMessage, getSiteTable,} from '../../dom/oldReddit/page'
import {renderAtLocation,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import createLogger from '../../util/infra/logging'
import {isOldReddit,} from '../../util/infra/platform'
import {getApiThingInfo,} from '../../util/reddit/thingInfo'
import {ActionTableRenderer,} from './components/ActionTableRenderer'
import {DismissButtonRenderer,} from './components/DismissButtonRenderer'
import {IgnoredReportsRenderer,} from './components/IgnoredReportsRenderer'
import type {QueueToolsSettings,} from './settings'

/** Raw thing data fields the ActionDetails table needs to derive a post's current approval/removal state. */
function getThingData (thingId: string,): Promise<Record<string, unknown>> {
	return getInfo(thingId,).then((thing: any,) => thing.data as Record<string, unknown>)
}

/** Ignored-report data for an item, or `null` when the current user doesn't mod the sub or reports aren't ignored. */
async function getIgnoredReports (
	subreddit: string,
	thingId: string,
): Promise<{modReports: Array<[string, string,]>; userReports: Array<[string, string,]>} | null> {
	if (!await isModSub(subreddit,)) { return null }
	const info = await getApiThingInfo(subreddit, thingId, false,)
	if (!info.reportsIgnored) { return null }
	return {modReports: info.modReports, userReports: info.userReports,}
}

const log = createLogger('QueueTools',)

/** Returns true if `obj` has own property `key`. */
function has (obj: object, key: PropertyKey,): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key,)
}

/**
 * Holds a single teardown function (e.g. a MutationObserver's disconnect) so a re-run can stop
 * the previous watcher before starting a new one, without each call site repeating the
 * call-then-null dance.
 * @returns A controller with `stop()` (tear down and clear) and `set(fn)` (adopt a new teardown).
 */
function createWatchController () {
	let stop: (() => void) | null = null
	return {
		/** Tears down the current watcher (if any) and clears it. */
		stop () {
			stop?.()
			stop = null
		},
		/** Adopts `fn` as the current teardown; call `stop()` first to replace an active watcher. */
		set (fn: () => void,) {
			stop = fn
		},
	}
}

/** Maps creature setting values to their CSS class names. */
const creatureClasses: Partial<Record<string, string>> = {
	'puppy': 'toolbox-puppy',
	'kitteh': 'toolbox-kitteh',
	'/r/spiderbros': 'toolbox-spiders',
	'piggy': 'toolbox-piggy',
}

/**
 * Registers queue tool renderers and returns page-level handlers.
 * @param settings Subset of QueueTools settings needed by the handlers.
 * @returns An object of handlers for reacting to page-level queue events, plus a cleanup function.
 *   Call `lifecycle.mount(handlers.cleanup)` in `index.ts`.
 */
export function createQueueHandlers (
	{showActionReason, showReportReasons, queueCreature, expandActionReasonQueue,}: Pick<
		QueueToolsSettings,
		'showActionReason' | 'showReportReasons' | 'queueCreature' | 'expandActionReasonQueue'
	>,
) {
	/** Per-subreddit modlog cache. Lives in the factory closure to avoid module-level mutable state. */
	const modlogCache: Record<
		string,
		{actions: Record<string, Record<string, any>>; activeFetch: boolean; lastFetch: number}
	> = {}
	// Disposal scope owned by this factory: tracks renderer registrations and
	// pending timeouts so everything is cancelled when the module cleans up.
	const scope = createLifecycle()

	/**
	 * Fetches the last 500 mod-log entries for a subreddit and populates the cache.
	 * @param subreddit Subreddit whose mod log to fetch.
	 * @param callback Invoked once the cache has been populated.
	 */
	function getModlog (subreddit: string, callback: () => void,) {
		getModLog(subreddit, {limit: '500',},).then((json: any,) => {
			json?.data?.children?.forEach((value: any,) => {
				const fullname = value.data.target_fullname
				const actionID = value.data.id
				if (!fullname || !has(modlogCache, subreddit,)) { return }
				if (!has(modlogCache[subreddit]!.actions, fullname,)) {
					modlogCache[subreddit]!.actions[fullname] = {}
				}
				modlogCache[subreddit]!.actions[fullname]![actionID] = value.data
			},)
			if (has(modlogCache, subreddit,)) {
				modlogCache[subreddit]!.activeFetch = false
			}
			callback()
		},).catch((error: unknown,) => {
			// On failure, clear the in-flight flag so getActions stops its 100ms retry
			// poll and a later request can refetch; still invoke the callback so the
			// caller resolves (checkForActions returns false when nothing was cached).
			log.error('Failed to fetch mod log:', error,)
			if (has(modlogCache, subreddit,)) {
				modlogCache[subreddit]!.activeFetch = false
			}
			callback()
		},)
	}

	/**
	 * Returns cached mod-log actions for a specific item, or `false` if none exist.
	 * @param subreddit Subreddit cache bucket to look in.
	 * @param fullname Reddit fullname (e.g. `t3_abc123`) of the item to look up.
	 * @returns A map of action ID to action data, or `false` if the item has no cached actions.
	 */
	function checkForActions (subreddit: string, fullname: string,): Record<string, any> | false {
		// Guard the cache bucket: callers reach here via getModlog's callback after
		// getActions created the entry, but a cleared/missing bucket must degrade to
		// "no actions" rather than throwing on the non-null assertion.
		const bucket = modlogCache[subreddit]
		if (bucket && has(bucket.actions, fullname,)) {
			return bucket.actions[fullname]!
		}
		return false
	}

	/**
	 * Retrieves mod-log actions for an item, fetching from the API if the cache is stale or missing.
	 * Results are cached per subreddit and refreshed after 5 minutes.
	 * @param subreddit Subreddit the item belongs to.
	 * @param fullname Reddit fullname of the item.
	 * @param callback Called with the action map (or `false` if no actions exist) once data is ready.
	 */
	function getActions (
		subreddit: string,
		fullname: string,
		callback: (result: Record<string, any> | false,) => void,
	) {
		log.debug(subreddit,)
		const dateNow = Date.now()
		if (!has(modlogCache, subreddit,)) {
			modlogCache[subreddit] = {actions: {}, activeFetch: true, lastFetch: dateNow,}
			getModlog(subreddit, () => callback(checkForActions(subreddit, fullname,),),)
		} else if (modlogCache[subreddit]!.activeFetch) {
			scope.timeout(() => getActions(subreddit, fullname, callback,), 100,)
		} else if (dateNow - modlogCache[subreddit]!.lastFetch > 300000) {
			getModlog(subreddit, () => callback(checkForActions(subreddit, fullname,),),)
		} else {
			callback(checkForActions(subreddit, fullname,),)
		}
	}

	// Disconnects the MutationObserver that removes the creature once a real queue
	// item appears beside it. Stored so it can be torn down on navigation/re-run.
	const itemWatch = createWatchController()

	/**
	 * Watches the creature's parent and removes the creature as soon as a real queue
	 * item is inserted next to it. The creature only renders when the queue is empty,
	 * so any sibling element added afterwards means an item arrived and the empty-state
	 * is no longer accurate.
	 * @param creatureEl The injected `#queueCreature` element to remove when items appear.
	 */
	function watchForQueueItems (creatureEl: Element,) {
		itemWatch.stop()

		const parent = creatureEl.parentElement
		if (!parent) { return }

		const disconnect = scope.observe(parent, (mutations,) => {
			const itemAppeared = mutations.some((mutation,) =>
				Array.from(mutation.addedNodes,).some((node,) => node instanceof Element && node !== creatureEl)
			)
			if (itemAppeared) {
				creatureEl.remove()
				itemWatch.stop()
			}
		}, {childList: true,},)
		itemWatch.set(disconnect,)
	}

	/**
	 * Builds the `#queueCreature` element with the configured creature's CSS class.
	 * @param creature The creature setting value selecting which creature class to apply.
	 * @returns The detached `<div id="queueCreature">` element, ready to be inserted.
	 */
	function buildCreatureEl (creature: string,): HTMLDivElement {
		const queueCreatureEl = document.createElement('div',)
		queueCreatureEl.id = 'queueCreature'
		const cls = creatureClasses[creature]
		if (cls) { queueCreatureEl.classList.add(cls,) }
		return queueCreatureEl
	}

	/**
	 * Replaces the "queue is clean" empty-state element with the configured creature.
	 * @param creature The creature setting value selecting which creature class to apply.
	 * @returns `true` if the empty-queue element was found and replaced, `false` if it
	 *   isn't in the DOM yet (so callers can keep waiting for it to render).
	 */
	function createCreatureImpl (creature: string,): boolean {
		// Old Reddit renders the empty modqueue as `p#noresults`; Shreddit uses a
		// `div[rpl]` containing the "Queue is clean." text.
		const emptyQueue = isOldReddit
			? getQueueEmptyMessage()
			: Array.from(document.querySelectorAll('div[rpl]',),).find((el,) =>
				el.textContent?.includes('Queue is clean.',)
			)
		if (!emptyQueue) { return false }

		const queueCreatureEl = buildCreatureEl(creature,)
		emptyQueue.replaceWith(queueCreatureEl,)
		// If an item shows up after the queue loaded clean, drop the creature.
		watchForQueueItems(queueCreatureEl,)
		return true
	}

	/**
	 * Shows the queue creature after the last item is removed from the DOM by dismissal.
	 * Unlike `createCreatureImpl`, there is no native empty-state element to replace - Reddit
	 * only server-renders `p#noresults` for queues that loaded empty - so the creature is
	 * appended directly into the `#siteTable` listing container. No-ops when the creature is
	 * disabled (`'i have no soul'`), when items remain, or when a creature is already present.
	 */
	function injectCreatureIfEmpty () {
		if (queueCreature === 'i have no soul') { return }
		const siteTable = getSiteTable()
		if (!siteTable) { return }
		if (siteTable.querySelector('.thing',)) { return }
		if (document.getElementById('queueCreature',)) { return }

		const queueCreatureEl = buildCreatureEl(queueCreature,)
		siteTable.append(queueCreatureEl,)
		// If a new item shows up later (e.g. via RES infinite scroll), drop the creature.
		watchForQueueItems(queueCreatureEl,)
	}

	/**
	 * Removes an actioned queue item from the DOM and, if it was the last one, shows the
	 * queue creature. Wired to the per-thing "dismiss" button via {@link DismissButtonRenderer}.
	 * @param thing The queue `.thing` element to remove.
	 */
	function dismissThing (thing: Element,) {
		thing.remove()
		injectCreatureIfEmpty()
	}

	// Old Reddit only: on Shreddit the ModActions module's inline "Recent actions" button (in the
	// mod-action row) already surfaces the per-item mod-log, so this near-the-timestamp "show recent
	// actions" table would only duplicate it.
	if (showActionReason && isOldReddit) {
		renderAtLocation('thingDetails', {id: 'queuetools.actions', lifecycle: scope,}, ({context,},) => {
			if (!context.thingId || !context.subreddit) { return null }
			return (
				<ActionTableRenderer
					context={context}
					getActions={getActions}
					checkIsMod={isModSub}
					getThingData={getThingData}
				/>
			)
		},)
	}

	if (showReportReasons) {
		renderAtLocation('thingActions', {id: 'queuetools.reports', lifecycle: scope,}, ({context,},) => {
			if (!context.thingId || !context.subreddit) { return null }
			return <IgnoredReportsRenderer context={context} getReports={getIgnoredReports} />
		},)
	}

	// Old Reddit only, and only on `/about/...` queue pages (modqueue, unmoderated, reports,
	// spam, edited): a per-item "dismiss" button on already-actioned things that removes them
	// from the DOM, surfacing the queue creature once the last item is gone.
	if (isOldReddit) {
		renderAtLocation('thingActions', {id: 'queuetools.dismiss', lifecycle: scope,}, ({target,},) => {
			if (!location.pathname.includes('/about/',)) { return null }
			return <DismissButtonRenderer target={target} onDismiss={dismissThing} />
		},)
	}

	// Disconnects the MutationObserver that waits for the empty-queue element on the
	// current queue page. Stored so a new navigation can tear down the previous watcher.
	const creatureWatch = createWatchController()

	/**
	 * Places the queue creature, retrying via a MutationObserver until the empty-queue
	 * element renders. On a fresh Shreddit page load the empty-state element hydrates
	 * asynchronously, so it's often absent when `TBNewPage` first fires; the observer
	 * catches it whenever it appears and then disconnects.
	 */
	function runCreature () {
		creatureWatch.stop()
		itemWatch.stop()

		if (createCreatureImpl(queueCreature,)) { return }

		const disconnect = scope.observe(document.body, () => {
			if (createCreatureImpl(queueCreature,)) {
				creatureWatch.stop()
			}
		}, {childList: true, subtree: true,},)
		// Stop scanning every mutation once hydration has had time to finish: a queue
		// with items never renders an empty-state element, so without this bound the
		// observer would run its DOM scan forever on a busy queue page.
		const cancelTimeout = scope.timeout(() => {
			creatureWatch.stop()
		}, 10000,)
		creatureWatch.set(() => {
			disconnect()
			cancelTimeout()
		},)
	}

	/** Handles `TBNewPage` - manages the `toolbox-show-actions` class and queue creature. */
	function handleNewPage (event: CustomEvent,) {
		if (expandActionReasonQueue && event.detail.pageType === 'queueListing') {
			document.body.classList.add('toolbox-show-actions',)
		} else {
			document.body.classList.remove('toolbox-show-actions',)
		}
		// Leaving the queue: stop any pending watcher from a previous queue page.
		if (event.detail.pageType !== 'queueListing') {
			creatureWatch.stop()
			itemWatch.stop()
			return
		}
		if (queueCreature !== 'i have no soul') {
			runCreature()
		}
	}

	return {runCreature, handleNewPage, cleanup: scope.cleanup,}
}

/** Inferred return type of `createQueueHandlers`. */
export type QueueHandlers = ReturnType<typeof createQueueHandlers>
