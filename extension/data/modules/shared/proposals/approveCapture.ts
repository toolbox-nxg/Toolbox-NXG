/**
 * Captures a trainee's *approvals* the way removals/locks/bans are already captured.
 * Reddit's native approve button isn't a Toolbox chokepoint, so a trainee clicking it
 * would otherwise perform a real approval with no review. This installs an always-on,
 * capture-phase click interceptor that - only when the current user is a (warm) trainee
 * in the item's subreddit - swallows the native approve and routes it through
 * {@link proposeOrApprove} so it becomes a reviewable proposal instead.
 *
 * Works on both old Reddit (button selectors on the `.thing`) and Shreddit (the approve
 * control in the light-DOM mod-actions or the overflow-menu shadow root, found via the
 * composed event path). Non-trainees are never affected: once the trainee state is warm a
 * confirmed non-trainee's native approve proceeds untouched. But the interceptor never
 * *falls open* on an unknown answer - when state isn't warm yet (startup / just-navigated)
 * an approve click is swallowed and routed through the gateway's accurate async decision,
 * which performs the real approval for a non-trainee and captures it for a trainee. The
 * moderated subs' trainee sets are warmed per page (see `setup.ts`), which also flips the
 * warm flag the fast path keys off, so the steady-state cost stays a single sync check.
 */

import {getThingFullname, getThingSubreddit,} from '../../../dom/oldReddit/things'
import {getThingContext,} from '../../../dom/shreddit/things'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {proposeOrApprove,} from './gateway'
import {isTraineeAnywhereSync, isTraineeForSync, isTraineeStateWarm,} from './traineeState'

/** Old-Reddit approve ("positive") buttons for posts (big mod buttons) and comments. */
const OLD_APPROVE_SELECTOR =
	'.flat-list .approve-button .togglebutton, .big-mod-buttons > span > .pretty-button.positive'

/** Shreddit approve controls - mirrors the native-remove selectors in `dom/shreddit/things`. */
const SHREDDIT_APPROVE_SELECTOR =
	'mod-action-button[data-mod-action="mod-approve-content"], button[data-testid="approve"], button[data-item-id="approve"]'

/** Shreddit "thing" custom elements that carry an item's id + subreddit. */
const SHREDDIT_THING_TAGS = new Set(['shreddit-post', 'shreddit-comment', 'mod-queue-list-item',],)

/** A resolved approve target: which item, in which subreddit, plus an optional link. */
interface ApproveTarget {
	subreddit: string
	itemId: string
	itemKind: 'post' | 'comment'
	link?: string
}

/** Makes a relative permalink absolute for cross-context display. */
function absolutize (permalink: string,): string {
	return permalink.startsWith('/',) ? `${location.origin}${permalink}` : permalink
}

/** Resolves an old-Reddit approve click to its target, or `null` if it isn't one. */
function resolveOldRedditApprove (event: MouseEvent,): ApproveTarget | null {
	const target = event.target
	if (!(target instanceof Element)) { return null }
	const button = target.closest(OLD_APPROVE_SELECTOR,)
	if (!button) { return null }
	const thing = button.closest('.thing',)
	if (!thing) { return null }
	const itemId = getThingFullname(thing,)
	const subreddit = getThingSubreddit(thing,)
	if (!itemId || !subreddit) { return null }
	const permalink = thing.getAttribute('data-permalink',)
	return {
		subreddit,
		itemId,
		itemKind: itemId.startsWith('t1_',) ? 'comment' : 'post',
		...(permalink ? {link: absolutize(permalink,),} : {}),
	}
}

/**
 * Resolves a Shreddit approve click to its target, or `null` if it isn't one. Uses the
 * composed path so a click inside the overflow-menu shadow root is still detected, and
 * resolves the owning thing element from the same path.
 */
function resolveShredditApprove (event: MouseEvent,): ApproveTarget | null {
	const path = event.composedPath()
	const onApprove = path.some((el,) => el instanceof Element && el.matches(SHREDDIT_APPROVE_SELECTOR,))
	if (!onApprove) { return null }
	const thing = path.find(
		(el,): el is Element => el instanceof Element && SHREDDIT_THING_TAGS.has(el.tagName.toLowerCase(),),
	)
	if (!thing) { return null }
	const ctx = getThingContext(thing,)
	if (!ctx) { return null }
	const permalink = thing.getAttribute('permalink',)
	return {
		subreddit: ctx.subreddit,
		itemId: ctx.thingId,
		itemKind: ctx.isComment ? 'comment' : 'post',
		...(permalink ? {link: absolutize(permalink,),} : {}),
	}
}

/**
 * Swallows the native approve click and routes the approval through the gateway. The
 * gateway's async path awaits the current user + config, so it makes the *accurate*
 * decision - capturing for a trainee, performing the real approval for a confirmed
 * non-trainee - even when the synchronous trainee state wasn't warm at click time.
 * @param event The captured click event to swallow.
 * @param target The resolved approve target.
 */
function captureOrPerformApprove (event: MouseEvent, target: ApproveTarget,): void {
	event.preventDefault()
	event.stopPropagation()
	event.stopImmediatePropagation()

	void proposeOrApprove({
		subreddit: target.subreddit,
		itemId: target.itemId,
		itemKind: target.itemKind,
		...(target.link ? {link: target.link,} : {}),
	},)
		.then((outcome,) => {
			// A trainee -> captured (toast). A confirmed non-trainee -> the gateway performed
			// the real approval (the native click we swallowed would have done the same);
			// no toast, matching the prior behavior.
			if (outcome === 'captured') { positiveTextFeedback('Approval sent for review',) }
		},)
		.catch(() => negativeTextFeedback('Could not capture the approval',))
}

/**
 * Capture-phase handler: if a trainee clicked a native approve button (old Reddit or
 * Shreddit), block it and capture the approval as a proposal instead. A no-op for
 * everyone else.
 *
 * Crucially, this never lets a native approve through on an *unknown* answer: a real
 * approval is irreversible-ish for a sandbox feature, so when the synchronous trainee
 * state isn't warm yet (startup / just-navigated), an approve click is swallowed and the
 * accurate async decision is awaited rather than falling open.
 * @param event The captured click event.
 */
export function handleApproveClick (event: MouseEvent,): void {
	const warm = isTraineeStateWarm()
	// Fast path for the overwhelming majority of clicks - but only trustworthy once warm:
	// a user sandboxed nowhere has nothing to intercept, so bail before any per-click work
	// (notably the Shreddit composedPath() scan). Before warm, a `false` here is unreliable,
	// so fall through to the careful path instead of skipping interception.
	if (warm && !isTraineeAnywhereSync()) { return }

	const target = resolveOldRedditApprove(event,) ?? resolveShredditApprove(event,)
	if (!target) { return }

	if (warm) {
		// Warm: the synchronous per-sub check is authoritative. Leave a confirmed
		// non-trainee's native approve untouched; capture a confirmed trainee's.
		if (!isTraineeForSync(target.subreddit,)) { return }
		captureOrPerformApprove(event, target,)
		return
	}

	// Not warm: a synchronous "not a trainee" can't be trusted and this is a real approve
	// click. Swallow it and let the async gateway decide accurately - unknown must never
	// fall open to a real, unreviewed approval for a sandboxed user.
	captureOrPerformApprove(event, target,)
}

/**
 * Installs the always-on approve interceptor. Called once from the proposals runtime so
 * it stays active regardless of any module's enabled state (a trainee must not be able
 * to disable their own sandbox). Covers old Reddit and Shreddit.
 */
export function installApproveCapture (): void {
	document.addEventListener('click', handleApproveClick, true,)
}
