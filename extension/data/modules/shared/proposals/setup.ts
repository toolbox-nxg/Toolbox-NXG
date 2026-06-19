/**
 * Wires the proposals runtime into the rest of the extension at startup: installs
 * the current-user provider and capture decision into the gateway, and the
 * synchronous capture predicate into the guard backstop. Called once from
 * `init.ts`. Kept separate from any UI module so the capture path is live even
 * before review UI exists.
 */

import {
	setCaptureActivePredicate,
	setCaptureAnywherePredicate,
	setPageSubreddit,
} from '../../../util/infra/captureGuard'
import {postSite,} from '../../../util/reddit/pageContext'
import {installApproveCapture,} from './approveCapture'
import {setupProposalsCrossTab,} from './events'
import {setActionGuardDecider, setCaptureDecider, setCurrentUserProvider,} from './gateway'
import {
	ensureTraineeStateLoaded,
	isActionGuardedFor,
	isTraineeAnywhereSync,
	isTraineeFor,
	isTraineeForSync,
	loadCurrentUser,
	resolveProposerName,
	setTraineeStateWarm,
	warmAllTraineeStates,
} from './traineeState'

/**
 * Monotonically increasing token for the current page context. Each {@link syncPageSubreddit}
 * bumps it; a warm only marks the trainee state ready when its token still matches, so a
 * slower warm from a previous page can't flip the flag true for a page whose own sets
 * haven't loaded yet (which would re-open the native-approve fail-open on overlapping SPA
 * navigation).
 */
let warmGeneration = 0

/**
 * Keeps the capture guard's page-subreddit fallback fresh. Used so a guarded
 * primitive reached with only a fullname (one that never registered an item->sub
 * mapping) can still resolve the current single-sub page's subreddit and
 * fail-closed for a trainee. Cleared to `undefined` on multi-sub/unknown pages so
 * the guard never resolves a stale or wrong subreddit.
 * @param subreddit The current page's subreddit, if it is a single-sub page.
 */
function syncPageSubreddit (subreddit: unknown,): void {
	const sub = typeof subreddit === 'string' && subreddit ? subreddit : undefined
	setPageSubreddit(sub,)
	// New page context: until this page's trainee state (current user + the relevant sets)
	// finishes warming, a synchronous "not a trainee" answer is unreliable, so block the
	// native-approve interceptor's fast path. It re-enables once the warm below settles.
	setTraineeStateWarm(false,)
	const generation = ++warmGeneration
	// Warm trainee state so the synchronous trainee checks (the capture guard backstop
	// and the native-approve interceptor) answer reliably before the first action,
	// rather than failing open on a cold cache.
	//
	// Single-sub page: that sub resolves every action, so warm just it. Multi-sub / unknown
	// page (cross-sub modqueue, a user page, the home feed): an action's subreddit may be
	// unresolvable, so warm every moderated sub, making the guard's "sandboxed anywhere?"
	// check reliable. Coalesced + cheap for non-mods (getModSubs is empty).
	const warm = sub ? ensureTraineeStateLoaded(sub,) : warmAllTraineeStates()
	// Mark warm only once both the current user and the page's sets have loaded; both
	// helpers swallow their own errors, so this resolves even when a read failed (the sets
	// then reflect that, rather than this hanging). Only flip the flag if no newer page
	// context has started since - otherwise an older page's warm could mark a newer,
	// not-yet-warmed page ready and re-open the fail-open.
	void Promise.all([loadCurrentUser(), warm,],).then(() => {
		if (generation === warmGeneration) { setTraineeStateWarm(true,) }
	},)
}

/** Installs the proposals providers and begins warming the current-user cache. */
export function initProposalsRuntime (): void {
	setCurrentUserProvider(resolveProposerName,)
	setCaptureActivePredicate(isTraineeForSync,)
	setCaptureAnywherePredicate(isTraineeAnywhereSync,)
	setCaptureDecider(isTraineeFor,)
	setActionGuardDecider(isActionGuardedFor,)
	// Seed the page-subreddit fallback from the load-time URL (correct and stable on
	// old Reddit; corrected by the first TBNewPage on Shreddit's SPA navigation), then
	// keep it current on every navigation so it can never resolve a stale subreddit.
	syncPageSubreddit(postSite,)
	window.addEventListener('TBNewPage', (event,) => {
		const detail = (event as CustomEvent).detail as {pageDetails?: {subreddit?: unknown}} | undefined
		syncPageSubreddit(detail?.pageDetails?.subreddit,)
	},)
	// Warm the current user so the synchronous backstop can answer as early as
	// possible; the gateway's async path awaits this regardless.
	void loadCurrentUser()
	// Capture a trainee's native approvals (old Reddit) into the proposals flow, the
	// same way removals/locks/bans are captured. Always-on, like the rest of this runtime.
	installApproveCapture()
	// Listen for proposal changes broadcast by other tabs so badges/counts/drawer stay
	// in sync. The message bridge (set up by init) is what delivers these window events.
	setupProposalsCrossTab()
}
