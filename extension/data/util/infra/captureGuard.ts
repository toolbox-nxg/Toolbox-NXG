/**
 * Runtime suppression guard for the proposals (training mode) feature - the
 * fail-closed backstop half of the two-invariant sandbox (the other half is the
 * static ESLint reachability rule). Lives in `util/infra` so the low-level API
 * primitives can import it without a layering inversion; the proposals module
 * wires the warm trainee context into it.
 *
 * Contract: every mutating moderation primitive calls {@link assertActionAllowed}
 * before doing anything. When the current user is sandboxed for the action's
 * subreddit and we are not inside an authorized replay, it throws
 * {@link CaptureSuppressedError} - guaranteeing a real action can never leak even
 * via a code path that forgot to route through the proposals gateway. A primitive
 * can only *block* (it lacks the composed intent to capture), so the gateway is
 * still what captures properly; this is the safety net.
 *
 * The capture decision is per-subreddit and answered synchronously from warm,
 * already-cached config (see the gateway/module wiring), so it is available before
 * the first button press. Where an action's subreddit cannot be resolved (a multi-sub
 * page), the guard fails closed only for a user who is sandboxed *somewhere* - blocking
 * the ambiguous action rather than leaking it; a non-trainee (sandboxed nowhere) is
 * never blocked. The static reachability rule + gateway remain the primary guarantee.
 */

import createLogger from './logging'

const log = createLogger('TBCaptureGuard',)

/** Thrown by {@link assertActionAllowed} when a real action is suppressed. */
export class CaptureSuppressedError extends Error {
	constructor (public action: string, public subreddit: string | undefined,) {
		super(
			`Action "${action}" suppressed: this account is in training/second-opinion mode`
				+ `${subreddit ? ` for /r/${subreddit}` : ''} and the action was not routed through review.`,
		)
		this.name = 'CaptureSuppressedError'
	}
}

/** Predicate answering "is the current user sandboxed (capture-active) for `sub`?" */
type CaptureActivePredicate = (subreddit: string,) => boolean

/** Default predicate: nobody is sandboxed until the proposals module wires one in. */
let captureActivePredicate: CaptureActivePredicate = () => false

/**
 * Installs the predicate that decides whether the current user is in
 * training/second-opinion capture mode for a given subreddit. Called by the
 * proposals module from warm config. Returns a disposer that restores the default.
 * @param predicate Synchronous per-subreddit capture-active check.
 */
export function setCaptureActivePredicate (predicate: CaptureActivePredicate,): () => void {
	captureActivePredicate = predicate
	return () => {
		captureActivePredicate = () => false
	}
}

/**
 * Returns whether the current user is sandboxed for `subreddit`. Synchronous -
 * backed by warm config via the installed predicate.
 * @param subreddit The subreddit to check.
 */
export function isCaptureActiveFor (subreddit: string,): boolean {
	try {
		return captureActivePredicate(subreddit,)
	} catch (err) {
		// A faulty predicate must never block real moderation; fail open here (the
		// gateway is the real capture path) and log loudly.
		log.error('capture predicate threw; treating as not-active', err,)
		return false
	}
}

/** Predicate answering "is the current user sandboxed (capture-active) in ANY subreddit?" */
type CaptureAnywherePredicate = () => boolean

/** Default predicate: nobody is sandboxed anywhere until the proposals module wires one in. */
let captureAnywherePredicate: CaptureAnywherePredicate = () => false

/**
 * Installs the predicate that decides whether the current user is sandboxed in *any*
 * subreddit at all. Used to fail closed when an action's subreddit cannot be resolved
 * (a multi-sub page): a sandboxed user is blocked rather than leaking a real action,
 * while a non-trainee - who is sandboxed nowhere - is still never blocked. Returns a
 * disposer that restores the default.
 * @param predicate Synchronous "sandboxed anywhere" check (warm state only).
 */
export function setCaptureAnywherePredicate (predicate: CaptureAnywherePredicate,): () => void {
	captureAnywherePredicate = predicate
	return () => {
		captureAnywherePredicate = () => false
	}
}

/** Whether the current user is sandboxed in any subreddit; fail-open on a faulty predicate. */
function isCaptureActiveAnywhere (): boolean {
	try {
		return captureAnywherePredicate()
	} catch (err) {
		log.error('capture-anywhere predicate threw; treating as not-active', err,)
		return false
	}
}

/** Item-fullname -> subreddit map, for resolving an action's sub on multi-sub pages. */
const itemSubreddits = new Map<string, string>()

/**
 * Registers the subreddit a thing belongs to, so a primitive that only receives a
 * fullname can still resolve its subreddit for the guard. Populated by the
 * button-attach code, which already knows each item's subreddit.
 * @param subreddit The subreddit it belongs to.
 * @param fullname The thing's fullname (e.g. `t3_abc`).
 */
export function registerItemSubreddit (subreddit: string, fullname: string,): void {
	itemSubreddits.set(fullname, subreddit,)
}

/** Forgets a registered item->subreddit mapping (e.g. when an item leaves the page). */
export function unregisterItemSubreddit (fullname: string,): void {
	itemSubreddits.delete(fullname,)
}

/** The single-subreddit context of the current page, when there is one. */
let pageSubreddit: string | undefined

/**
 * Sets the current page's subreddit, used as the fallback when an action's
 * subreddit isn't otherwise known (single-sub pages: a sub's modqueue, a post).
 * @param subreddit The page subreddit, or undefined to clear.
 */
export function setPageSubreddit (subreddit: string | undefined,): void {
	pageSubreddit = subreddit
}

/** Resolves the subreddit for a guard check from explicit sub, item map, or page. */
function resolveSubreddit (opts: AssertOptions | undefined,): string | undefined {
	if (opts?.subreddit) { return opts.subreddit }
	if (opts?.fullname) {
		const mapped = itemSubreddits.get(opts.fullname,)
		if (mapped) { return mapped }
	}
	return pageSubreddit
}

// --- authorized replay context -------------------------------------------------

/** Nesting depth of authorized replays in progress. */
let replayDepth = 0

/** Returns whether execution is currently inside an authorized proposal replay. */
export function isInReplay (): boolean {
	return replayDepth > 0
}

/**
 * Runs `fn` as an authorized proposal replay, during which mutating primitives are
 * permitted (the gateway uses this when Accepting a proposal). Uses a depth counter
 * so nested replays are handled; restores on both success and failure.
 *
 * LIMITATION: the counter is process-global, not async-context-local (the browser has
 * no AsyncLocalStorage), so any guarded action that *starts* while a replay is awaiting
 * also sees `isInReplay()` true and is permitted. In practice this is safe because a
 * replay only runs for a reviewer accepting a proposal, who is not sandboxed for that
 * subreddit - the per-subreddit predicate, not this window, is the real gate. A precise
 * fix would thread a per-call authorization token through every primitive; deferred as
 * disproportionate to the (cross-sub, concurrent) race it would close.
 * @param fn The replay work to run.
 */
export async function runInReplay<T,> (fn: () => Promise<T>,): Promise<T> {
	replayDepth++
	try {
		return await fn()
	} finally {
		replayDepth--
	}
}

// --- test/dev tripwire ---------------------------------------------------------

/** When true, ANY guarded action throws unless in replay (test/dev assertion). */
let captureExpected = false

/**
 * Test/dev only: assert that no real moderation action should fire right now, so a
 * capture-path test can prove "zero primitives executed." Has no role in
 * production (the per-subreddit predicate is the real gate). Returns a disposer that
 * restores the prior value - like the predicate setters - so a leaked `true` can't
 * trip unrelated guarded calls in a later test.
 * @param expected Whether to expect capture (suppress all non-replay actions).
 */
export function setCaptureExpected (expected: boolean,): () => void {
	const previous = captureExpected
	captureExpected = expected
	return () => {
		captureExpected = previous
	}
}

// --- the guard ------------------------------------------------------------------

/** Options identifying which subreddit a guarded action targets. */
export interface AssertOptions {
	/** Fullname of the targeted thing (resolved to a subreddit via the item map). */
	fullname?: string
	/** Explicit subreddit, when the primitive knows it (e.g. ban/mute). */
	subreddit?: string
}

/**
 * Throws {@link CaptureSuppressedError} if performing a real moderation action now
 * would violate the training/second-opinion sandbox. Called at the top of every
 * mutating moderation primitive.
 *
 * Allowed (no throw) when: inside an authorized replay; or the resolved subreddit
 * is not capture-active (the common case - non-trainees); or the subreddit cannot be
 * resolved AND the user is sandboxed nowhere (a non-trainee is never blocked).
 *
 * When the subreddit cannot be resolved (a multi-sub page) but the user *is* sandboxed
 * somewhere, we cannot prove the action is outside their sandbox, so we fail closed -
 * blocking it rather than leaking a real moderation action. The block carries no
 * captured intent (the primitive lacks one); the gateway remains the path that captures
 * properly. A non-trainee is sandboxed nowhere, so this never blocks legitimate mod work.
 * @param action Name of the primitive, for the error message.
 * @param opts How to resolve the action's subreddit.
 */
export function assertActionAllowed (action: string, opts?: AssertOptions,): void {
	if (isInReplay()) { return }
	const subreddit = resolveSubreddit(opts,)
	if (subreddit) {
		if (isCaptureActiveFor(subreddit,)) {
			throw new CaptureSuppressedError(action, subreddit,)
		}
	} else if (isCaptureActiveAnywhere()) {
		// Unresolved subreddit + a sandboxed user ⇒ fail closed (can't prove it's safe).
		throw new CaptureSuppressedError(action, undefined,)
	}
	// Test/dev tripwire: a test asserting "no real action should fire" trips here
	// regardless of subreddit resolution.
	if (captureExpected) {
		throw new CaptureSuppressedError(action, subreddit,)
	}
}
