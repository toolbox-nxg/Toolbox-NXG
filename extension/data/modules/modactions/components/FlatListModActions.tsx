/**
 * Inline moderator-action buttons rendered into a Shreddit thing's flat-list row
 * (`toolbox-flat-list-slot`). Surfaces the mod actions that otherwise live in Reddit's lazy ⋯
 * overflow menu - Remove as Spam, Lock/Unlock, Distinguish (comments), Sticky/Unsticky and
 * Mark/Unmark NSFW (posts), plus a per-item "Recent actions" history popup - so a moderator can
 * act without opening the menu. Every action routes through the proposals gateway, so training-mode
 * capture and the second-opinion flow apply uniformly (UI must never call the moderation API
 * primitives directly).
 *
 * Renders the inline set: Spam and the Toolbox Remove link (shown until the item is removed), then
 * Approve (shown on any removed item, as the inverse of Spam/Remove), then Lock and the
 * post/comment-specific toggles. Reddit's own inline mod actions are hidden by CSS, so these stand in
 * for them. The Remove link carries the `toolbox-removal-reason-remove` class so the removalreasons
 * document-level handler drives its click; this component only emits the markup (it already depends
 * on removalreasons for the Spam -> removal-overlay path).
 */

import {useEffect, useState, useSyncExternalStore,} from 'react'

import {getCurrentUser,} from '../../../api/resources/me'
import {FlatListAction,} from '../../../shared/controls/FlatListAction'
import {useIsMod,} from '../../../shared/controls/useIsMod'
import {positiveTextFeedback,} from '../../../store/feedback'
import createLogger from '../../../util/infra/logging'
import {classes,} from '../../../util/ui/reactMount'
import {openRemovalReasonOverlay,} from '../../removalreasons/overlayOpener'
import {
	type ProposalContext,
	proposeOrApprove,
	proposeOrDistinguish,
	proposeOrLock,
	proposeOrMarkNsfw,
	type ProposeOrPerformResult,
	proposeOrSticky,
	proposeOrUnlock,
	proposeOrUnsticky,
} from '../../shared/proposals/gateway'
import {ensureRecentActionsLoaded, itemHasRecentActions, subscribeRecentActions,} from '../recentActionsStore'
import {openItemHistory,} from './ItemHistoryPopup'

const log = createLogger('ModActions',)

/** Props for the inline mod-action row. */
export interface FlatListModActionsProps {
	/** Subreddit the thing belongs to (no `r/` prefix). */
	subreddit: string
	/** Fullname of the post/comment (`t3_...`/`t1_...`). */
	itemId: string
	/** Whether the thing is a post or a comment (drives which actions show). */
	itemKind: 'post' | 'comment'
	/** Whether the thing is already removed (hides the Spam button). */
	isRemoved: boolean
	/** Initial NSFW state, read from the post's `nsfw` attribute (posts only). */
	initialNsfw?: boolean | undefined
	/** Initial locked state, read best-effort from the thing's `locked` attribute. */
	initialLocked?: boolean | undefined
	/** Initial stickied state, read best-effort from the post's `stickied`/`pinned` attribute (posts only). */
	initialStickied?: boolean | undefined
	/** Relative permalink for the item, recorded on captured proposals for display. */
	link?: string | undefined
	/** Comment author (comments only); Distinguish is only offered on the viewer's own comments. */
	author?: string | undefined
}

/** Visual/interaction state of a single action button. */
type ButtonState = 'idle' | 'pending' | 'done' | 'error'

/** Props for one action button. */
interface ModActionButtonProps {
	/** Label shown in the idle state (already reflects any toggle direction). */
	label: string
	/** Accessible tooltip describing the action. */
	title: string
	/** Performs the action via the gateway. */
	run: () => Promise<ProposeOrPerformResult>
	/** Feedback shown when the action was captured for review instead of performed. */
	capturedMessage: string
	/** Called after a real (`'performed'`) action - lets the parent flip toggle state. */
	onPerformed?: () => void
	/** Terminal label shown after a successful one-shot perform (e.g. "spammed"); omit for toggles. */
	performedLabel?: string
}

/**
 * A single mod-action button, rendered as a link styled like Reddit's native pills. Runs its
 * gateway action on click and reflects pending/error feedback. Always stops the click from reaching
 * Shreddit's full-post overlay link so the action fires instead of navigating to the post.
 */
function ModActionButton (
	{label, title, run, capturedMessage, onPerformed, performedLabel,}: ModActionButtonProps,
) {
	const [state, setState,] = useState<ButtonState>('idle',)

	/** Runs the action, mapping the gateway outcome to button feedback. */
	async function onClick () {
		if (state === 'pending') { return }
		setState('pending',)
		try {
			const result = await run()
			if (result === 'captured') {
				// Captured for review - nothing changed on Reddit, so keep the original label.
				positiveTextFeedback(capturedMessage,)
				setState('idle',)
			} else {
				onPerformed?.()
				setState(performedLabel ? 'done' : 'idle',)
			}
		} catch (error) {
			log.error(`mod action "${label}" failed:`, error,)
			setState('error',)
			setTimeout(() => setState('idle',), 2000,)
		}
	}

	const text = state === 'done' && performedLabel
		? performedLabel
		: state === 'error'
		? `${label} failed`
		: label

	return (
		<FlatListAction
			className={classes(
				state === 'pending' && 'is-pending',
				state === 'error' && 'is-error',
			)}
			title={title}
			onClick={onClick}
		>
			{text}
		</FlatListAction>
	)
}

/** Renders the inline mod-action buttons for a Shreddit post/comment when the viewer is a mod. */
export function FlatListModActions (
	{subreddit, itemId, itemKind, isRemoved, initialNsfw, initialLocked, initialStickied, link, author,}:
		FlatListModActionsProps,
) {
	// Only moderators of the sub may act; `null` until the cached check resolves.
	const isMod = useIsMod(subreddit,)
	// Logged-in username, used to limit Distinguish to the viewer's own comments (Reddit only allows
	// distinguishing your own). `null` until resolved.
	const [currentUser, setCurrentUser,] = useState<string | null>(null,)
	// Toggle directions seeded best-effort from the thing's DOM attributes (read in dom.tsx) so the
	// first click goes the right way, then flipped locally after a real action. When Shreddit doesn't
	// expose a readable attribute the seed falls back to the primary verb (Lock/Sticky), and a wrong
	// first click there self-corrects on the next render.
	const [locked, setLocked,] = useState(initialLocked ?? false,)
	const [stickied, setStickied,] = useState(initialStickied ?? false,)
	const [nsfw, setNsfw,] = useState(initialNsfw ?? false,)
	// Local removed-state, seeded from the location context (a snapshot captured once at injection and
	// never refreshed). The row's own Approve flips it back to not-removed so Spam/Remove reappear
	// without a page reload. The reverse (Spam/Remove -> removed) isn't reflected here: those route
	// through the removal overlay, which can be cancelled and reports completion across the
	// document-handler boundary - the overlay is the feedback there.
	const [removed, setRemoved,] = useState(isRemoved,)

	// Resolve the logged-in username so Distinguish can be limited to the viewer's own comments.
	// Only needed for comments; posts never show Distinguish.
	useEffect(() => {
		if (itemKind !== 'comment') { return }
		let cancelled = false
		void getCurrentUser().then((value,) => {
			if (!cancelled) { setCurrentUser(value,) }
		},).catch(() => {
			if (!cancelled) { setCurrentUser(null,) }
		},)
		return () => {
			cancelled = true
		}
	}, [itemKind,],)

	// Fetch this sub's recent mod-log window once we know the viewer is a mod, then show the
	// "Recent actions" button only for items the log actually touched (otherwise the popup would
	// just read "No recent mod actions for this item").
	useEffect(() => {
		if (isMod === true) { ensureRecentActionsLoaded(subreddit,) }
	}, [isMod, subreddit,],)
	const hasRecentActions = useSyncExternalStore(
		subscribeRecentActions,
		() => itemHasRecentActions(subreddit, itemId,),
	)

	if (isMod !== true) { return null }

	const isPost = itemKind === 'post'
	// Distinguish only applies to the viewer's own comments (Reddit disallows distinguishing others').
	const isOwnComment = !isPost && currentUser !== null && !!author
		&& author.toLowerCase() === currentUser.toLowerCase()
	const ctx: ProposalContext = {subreddit, itemId, itemKind, ...(link ? {link,} : {}),}

	return (
		<>
			{!removed && (
				<FlatListAction
					title="Remove as spam (opens the removal-reason options)"
					onClick={() => {
						openRemovalReasonOverlay({
							thingID: itemId,
							thingSubreddit: subreddit,
							isComment: itemKind === 'comment',
							spam: true,
						},)
					}}
				>
					Spam
				</FlatListAction>
			)}
			{!removed && (
				// Toolbox Remove, rendered here so it sits right after Spam (the two removal actions
				// grouped, Spam first). It carries `toolbox-removal-reason-remove` so the removalreasons
				// document-level capture handler routes the click to the removal overlay - the same
				// markup contract removalreasons relies on; this component only emits it. No `onClick`:
				// the click must bubble to that document-level handler, so {@link FlatListAction} leaves
				// propagation untouched.
				<FlatListAction
					className="toolbox-removal-reason-remove"
					title="Remove this item (opens the removal-reason options)"
					data-id={itemId}
					data-subreddit={subreddit}
				>
					Remove
				</FlatListAction>
			)}
			{removed && (
				// Approve is the inverse of Spam/Remove (both hidden once removed), surfaced on any
				// removed item and routed through the gateway like the rest. The native approve is
				// hidden on removed rows by CSS - for posts it otherwise lives in the hidden
				// `shreddit-mod-inline-actions` host (feed) or as a kept `mod-action-button`
				// (post-detail/queue) - so this Toolbox one doesn't duplicate it. See toolbox-buttons.css.
				// On a real approve, flip `removed` so the row swaps back to Spam/Remove (no terminal
				// label: the swap itself is the feedback); a captured trainee approve leaves it shown.
				<ModActionButton
					label="Approve"
					title={isPost ? 'Approve this post' : 'Approve this comment'}
					capturedMessage="Approve sent for review"
					onPerformed={() => setRemoved(false,)}
					run={() => proposeOrApprove(ctx,)}
				/>
			)}
			<ModActionButton
				label={locked ? 'Unlock' : 'Lock'}
				title={locked ? 'Unlock this thread' : 'Lock this thread'}
				capturedMessage="Lock change sent for review"
				onPerformed={() => setLocked((v,) => !v)}
				run={() => locked ? proposeOrUnlock(ctx,) : proposeOrLock(ctx,)}
			/>
			{isOwnComment && (
				<ModActionButton
					label="Distinguish"
					title="Distinguish as moderator"
					performedLabel="distinguished"
					capturedMessage="Distinguish sent for review"
					run={() => proposeOrDistinguish(ctx, false,)}
				/>
			)}
			{isPost && (
				<ModActionButton
					label={stickied ? 'Unsticky' : 'Sticky'}
					title={stickied ? 'Unsticky this post' : 'Sticky this post'}
					capturedMessage="Sticky change sent for review"
					onPerformed={() => setStickied((v,) => !v)}
					run={() => stickied ? proposeOrUnsticky(ctx,) : proposeOrSticky(ctx, undefined,)}
				/>
			)}
			{isPost && (
				<ModActionButton
					label={nsfw ? 'Unmark NSFW' : 'Mark NSFW'}
					title={nsfw ? 'Remove the NSFW mark' : 'Mark as NSFW'}
					capturedMessage="NSFW change sent for review"
					onPerformed={() => setNsfw((v,) => !v)}
					run={() => proposeOrMarkNsfw(ctx, !nsfw,)}
				/>
			)}
			{hasRecentActions && (
				<FlatListAction
					title="Show recent mod actions on this item"
					onClick={() => openItemHistory({subreddit, itemId,},)}
				>
					Recent actions
				</FlatListAction>
			)}
		</>
	)
}
