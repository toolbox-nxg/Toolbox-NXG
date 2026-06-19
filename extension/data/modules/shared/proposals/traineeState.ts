/**
 * Warm, synchronously-readable training-mode state for the current user.
 *
 * The capture decision is "is the current user on subreddit X's `trainingMods`
 * list?" - derived from the already-cached Toolbox config. This module caches the
 * current username and a per-subreddit trainee set so the capture guard can answer
 * synchronously (the fail-closed backstop), while the gateway uses the async
 * variant that awaits the config so the decision is accurate even before the state
 * is warm. All comparisons are case-insensitive.
 */

import {getCurrentUser,} from '../../../api/resources/me'
import {getModSubs,} from '../../../api/resources/modSubs'
import {mapWithConcurrency,} from '../../../util/data/async'
import createLogger from '../../../util/infra/logging'
import {isUserProfileSubreddit,} from '../../../util/reddit/profileSubreddit'
import {tryGetConfig,} from '../../config/moduleapi'
import {normalizeUsername,} from './usernames'

const log = createLogger('TBProposals',)

/** Max concurrent config reads while warming every moderated sub's trainee set. */
const WARM_ALL_CONCURRENCY = 6

/** The current username (original case), or '' until loaded. */
let currentUser = ''
/** The current username lowercased, for case-insensitive membership tests. */
let currentUserLower = ''
/** Whether the current user has been resolved yet. */
let currentUserLoaded = false
let currentUserPromise: Promise<void> | null = null

/** Per-subreddit (lowercased) set of trainee usernames (lowercased). */
const traineeSets = new Map<string, Set<string>>()
/**
 * Per-subreddit (lowercased) set of guarded action-type discriminants, or `undefined`
 * for a sub whose config omits `guardedActions` - which means *all* actions are
 * guarded (the original all-or-nothing behavior). Populated alongside the trainee set
 * by {@link ensureTraineeStateLoaded}.
 */
const guardedActionSets = new Map<string, Set<string> | undefined>()
/**
 * Subreddits (lowercased) whose config could not be *read* (transient error / unparseable),
 * as distinct from a sub with no config page (which is a definite "no trainees"). Training
 * state there is unknown, so the checks below fail **safe** - treat the user as a trainee so
 * the action is captured for review rather than performed live. Not a terminal cache: these
 * subs are absent from {@link traineeSets}, so {@link ensureTraineeStateLoaded} re-attempts
 * the read on the next call rather than locking in "unknown".
 */
const unreadableSubs = new Set<string>()
/** In-flight per-subreddit loads, coalesced so concurrent callers share one fetch. */
const loading = new Map<string, Promise<void>>()

/**
 * Whether the trainee state needed for the *current page* has finished warming (the current
 * user plus the page's trainee sets). Until this is true a synchronous "not a trainee"
 * answer is unreliable - the set simply may not be loaded yet - so the native-approve
 * interceptor must not treat it as "let the approval through." Set by the proposals runtime
 * after each page's warm settles (and reset on navigation / config invalidation).
 */
let pageWarmReady = false

/** Whether the current page's trainee state has warmed (see {@link pageWarmReady}). */
export function isTraineeStateWarm (): boolean {
	return pageWarmReady
}

/**
 * Records whether the current page's trainee state is warm. The runtime sets `false` on
 * each navigation (before kicking the page's warm) and `true` once that warm settles, so
 * the synchronous checks are only trusted to answer `false` when they actually can.
 * @param ready Whether the page's warm has completed.
 */
export function setTraineeStateWarm (ready: boolean,): void {
	pageWarmReady = ready
}

/** Resolves and caches the current username (idempotent, coalesced). */
export function loadCurrentUser (): Promise<void> {
	if (currentUserLoaded) { return Promise.resolve() }
	if (!currentUserPromise) {
		currentUserPromise = getCurrentUser()
			.then((name,) => {
				currentUser = name
				currentUserLower = normalizeUsername(name,)
				currentUserLoaded = true
			},)
			.catch((err,) => {
				log.warn('could not resolve current user for training-mode checks', err,)
			},)
			.finally(() => {
				currentUserPromise = null
			},)
	}
	return currentUserPromise
}

/** The current username (original case), or '' if not yet resolved. */
export function getProposerName (): string {
	return currentUser
}

/**
 * Resolves the current username, awaiting the (coalesced) current-user load first so
 * callers that must record a proposer - e.g. a forced second-opinion capture that
 * skips the trainee-state async path - never read the cache before it warms. Returns
 * '' only when the load itself could not resolve a user.
 */
export async function resolveProposerName (): Promise<string> {
	await loadCurrentUser()
	return currentUser
}

/**
 * Loads (and caches) a subreddit's trainee set from its Toolbox config. Coalesces
 * concurrent loads for the same subreddit.
 * @param subreddit The subreddit to load.
 */
export function ensureTraineeStateLoaded (subreddit: string,): Promise<void> {
	const key = subreddit.toLowerCase()
	if (traineeSets.has(key,)) { return Promise.resolve() }
	const inFlight = loading.get(key,)
	if (inFlight) { return inFlight }
	const promise = (async () => {
		try {
			const result = await tryGetConfig(subreddit,)
			if (result.status === 'error') {
				// Couldn't read the config - training state is unknown. Mark the sub unreadable
				// (the checks fail safe to "capture") and leave it OUT of traineeSets so the next
				// check re-attempts the read rather than locking in this transient failure.
				unreadableSubs.add(key,)
				return
			}
			// `absent` (no config page) is a definite "no trainees"; `ok` carries the real list.
			const config = result.status === 'ok' ? result.config : undefined
			const mods = config?.trainingMods ?? []
			traineeSets.set(key, new Set(mods.map(normalizeUsername,),),)
			// `guardedActions` absent ⇒ undefined here ⇒ "all actions guarded"; an explicit
			// (possibly empty) list narrows to just those types. Normalization already filtered
			// it to valid discriminants, so no validation is needed at action time.
			const guarded = config?.guardedActions
			guardedActionSets.set(key, guarded ? new Set(guarded,) : undefined,)
			// A successful read supersedes any prior unreadable marking.
			unreadableSubs.delete(key,)
		} catch (err) {
			// An unexpected rejection (e.g. layout resolution threw) is the same as a read
			// error: unknown state, fail safe to "capture", and retryable next call.
			log.warn(`could not load trainingMods for /r/${subreddit}`, err,)
			unreadableSubs.add(key,)
		} finally {
			loading.delete(key,)
		}
	})()
	loading.set(key, promise,)
	return promise
}

/**
 * Synchronous capture check for the guard backstop: true only when the current
 * user and the subreddit's trainee set are already warm and the user is a trainee.
 * Returns false (fail-open) when state isn't loaded yet - the gateway's async path
 * is the accurate decision; this is the secondary net.
 * @param subreddit The subreddit to check.
 */
export function isTraineeForSync (subreddit: string,): boolean {
	if (!currentUserLoaded || !currentUserLower) { return false }
	const key = subreddit.toLowerCase()
	const set = traineeSets.get(key,)
	if (set) { return set.has(currentUserLower,) }
	// Config unreadable ⇒ training state unknown ⇒ fail safe to "trainee" so the action is
	// captured, never performed live. A sub that simply hasn't loaded yet stays false (the
	// async path is the accurate decision and will load + re-check).
	return unreadableSubs.has(key,)
}

/**
 * Synchronous "is the current user a trainee in **any** subreddit whose state is warm?"
 * Backs the capture guard's fail-closed decision when an action's subreddit can't be
 * resolved on a multi-sub page. Answers from warm state only (false until warm), so it
 * never blocks a non-trainee, and before the all-subs warm completes the worst case is
 * the prior fail-open behavior. Warmed across moderated subs by {@link warmAllTraineeStates}.
 */
export function isTraineeAnywhereSync (): boolean {
	if (!currentUserLoaded || !currentUserLower) { return false }
	// Any sub we couldn't read leaves training state unknown there, so fail safe to "yes":
	// the native-approve fast path then won't bail and instead takes the careful per-sub
	// capture path (which re-derives the accurate answer for the action's actual sub).
	if (unreadableSubs.size > 0) { return true }
	for (const set of traineeSets.values()) {
		if (set.has(currentUserLower,)) { return true }
	}
	return false
}

/**
 * Accurate async capture check used by the gateway: ensures the current user and
 * the subreddit's trainee set are loaded, then tests membership.
 * @param subreddit The subreddit to check.
 */
export async function isTraineeFor (subreddit: string,): Promise<boolean> {
	await loadCurrentUser()
	await ensureTraineeStateLoaded(subreddit,)
	return isTraineeForSync(subreddit,)
}

/**
 * Whether `actionType` is guarded (captured for review) for `subreddit`. Used by the
 * gateway to decide per-action capture once a user is known to be a trainee. A sub
 * whose config omits `guardedActions` guards everything (returns true for any type);
 * otherwise only the listed types are guarded. Ensures the sub's state is warm first.
 * @param subreddit The subreddit to check.
 * @param actionType The {@link ProposedActionType} discriminant being attempted.
 */
export async function isActionGuardedFor (subreddit: string, actionType: string,): Promise<boolean> {
	await ensureTraineeStateLoaded(subreddit,)
	const set = guardedActionSets.get(subreddit.toLowerCase(),)
	// `undefined` ⇒ config omits the list ⇒ guard everything.
	return set ? set.has(actionType,) : true
}

/** Coalesces the all-subs warm so it fans out at most once (until it fails or is invalidated). */
let warmAllPromise: Promise<void> | null = null

/**
 * Warms the trainee set for **every** subreddit the current user moderates, so the
 * synchronous trainee check is reliable on multi-sub pages (the cross-sub modqueue),
 * where an item can belong to any moderated subreddit and the per-page warm can't know
 * which until it's actioned. Bounded fan-out (config reads are cached/cheap after the
 * first). Coalesced: concurrent and repeat calls share one pass - a successful warm stays
 * cached until {@link invalidateTraineeState}; a failed listing resets so a later
 * navigation can retry.
 */
export function warmAllTraineeStates (): Promise<void> {
	if (warmAllPromise) { return warmAllPromise }
	warmAllPromise = (async () => {
		let subs: string[]
		try {
			subs = await getModSubs()
		} catch (err) {
			log.warn('could not list moderated subs to warm trainee state', err,)
			// Reset so a later navigation retries rather than caching this transient failure.
			warmAllPromise = null
			return
		}
		// Reddit lists the viewer's own profile (`u_<username>`) among their moderated
		// subs, but it has no toolbox config/training state - skip it so the warm doesn't
		// fire doomed config reads for it.
		const realSubs = subs.filter((subreddit,) => !isUserProfileSubreddit(subreddit,))
		// `ensureTraineeStateLoaded` never rejects (a read error marks the sub unreadable
		// rather than throwing), so the bounded fan-out can't throw.
		await mapWithConcurrency(realSubs, WARM_ALL_CONCURRENCY, (subreddit,) => ensureTraineeStateLoaded(subreddit,),)
	})()
	return warmAllPromise
}

/**
 * Drops cached trainee state so the next check re-reads config (e.g. after the
 * trainee list is edited in settings).
 * @param subreddit The subreddit to invalidate, or omit to clear all.
 */
export function invalidateTraineeState (subreddit?: string,): void {
	// Let the next multi-sub page re-run the all-subs warm against fresh config.
	warmAllPromise = null
	// The cached sets the sync checks read are now stale/cleared, so they can't be trusted
	// to answer `false` until the next page warm re-populates them; block the fast path.
	pageWarmReady = false
	if (subreddit === undefined) {
		traineeSets.clear()
		guardedActionSets.clear()
		unreadableSubs.clear()
	} else {
		const key = subreddit.toLowerCase()
		traineeSets.delete(key,)
		guardedActionSets.delete(key,)
		unreadableSubs.delete(key,)
	}
}
