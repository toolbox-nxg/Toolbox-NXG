/** Renders a per-comment lock/unlock button and provides handlers to process new comment things. */
import {useEffect, useState,} from 'react'

import {getCommentRemoveButton, getUncheckedComments,} from '../../../dom/oldReddit/things'
import {provideLocation, renderAtLocation,} from '../../../dom/uiLocations'
import {createLifecycle,} from '../../../framework/lifecycle'
import {positiveTextFeedback,} from '../../../store/feedback'
import {forEachChunkedDynamic,} from '../../../util/data/iter'
import createLogger from '../../../util/infra/logging'
import {RedditPlatform,} from '../../../util/infra/platform'
import {getThingInfo,} from '../../../util/reddit/thingInfo'
import {proposeOrLock, proposeOrUnlock,} from '../../shared/proposals/gateway'
import {createDisposalGuard,} from './disposalGuard'

const log = createLogger('BButtons',)

interface CommentLockDetail {
	comment: Element
	initialLocked: boolean
	type: 'commentLock'
}

/** Props for the CommentLockButton component. */
interface CommentLockButtonProps {
	/** Whether the comment is currently locked. */
	initialLocked: boolean
	/** The old-Reddit comment DOM element this button acts on. */
	comment: Element
}

/**
 * Manages lock/unlock toggle state for a single comment.
 * @param comment The old-Reddit comment DOM element.
 * @param initialLocked Whether the comment is initially locked.
 * @returns Current locked state, processing flag, and a toggle handler.
 */
function useCommentLockToggle (comment: Element, initialLocked: boolean,) {
	const [locked, setLocked,] = useState(initialLocked,)
	const [processing, setProcessing,] = useState(false,)

	async function toggle () {
		// comment is typed as Element at the call site; guard before passing to getThingInfo
		if (!(comment instanceof HTMLElement)) { return }
		setProcessing(true,)
		const info = await getThingInfo(comment, true,)
		if (!info) {
			setProcessing(false,)
			return
		}
		try {
			const ctx = {
				subreddit: info.subreddit,
				itemId: info.fullname,
				itemKind: 'comment' as const,
				...(info.permalink ? {link: info.permalink,} : {}),
			}
			const outcome = await (locked ? proposeOrUnlock(ctx,) : proposeOrLock(ctx,))
			// Captured for review: the lock state didn't actually change, so don't flip.
			if (outcome === 'captured') {
				positiveTextFeedback('Sent for review',)
				return
			}
			const nextLocked = !locked
			comment.dispatchEvent(
				new CustomEvent('toolbox-comment-lock-change', {
					detail: {locked: nextLocked,},
				},),
			)
			setLocked(nextLocked,)
		} catch (error) {
			log.error('Error toggling lock on comment:\n', error,)
		} finally {
			setProcessing(false,)
		}
	}

	return {locked, processing, toggle,}
}

/** Renders a lock/unlock action link for a single comment, toggling the Reddit lock state on click. */
function CommentLockButton ({initialLocked, comment,}: CommentLockButtonProps,) {
	const {locked, processing, toggle,} = useCommentLockToggle(comment, initialLocked,)
	const action = locked ? 'unlock' : 'lock'

	return (
		<a
			className="toolbox-comment-lock-button"
			style={{opacity: processing ? 0.5 : undefined, cursor: 'pointer',}}
			onClick={() => void toggle()}
		>
			{action}
		</a>
	)
}

function CommentLockStatus ({initialLocked, comment,}: CommentLockButtonProps,) {
	const [locked, setLocked,] = useState(initialLocked,)

	useEffect(() => {
		const handleLockChange = (event: Event,) => {
			const detail = (event as CustomEvent<unknown>).detail
			// Validate the event payload before trusting it; a malformed detail
			// would otherwise read `undefined` into the locked state with no signal.
			if (typeof (detail as {locked?: unknown} | null)?.locked !== 'boolean') {
				log.warn('Ignoring toolbox-comment-lock-change event with unexpected detail shape', detail,)
				return
			}
			setLocked((detail as {locked: boolean}).locked,)
		}
		comment.addEventListener('toolbox-comment-lock-change', handleLockChange,)
		return () => {
			comment.removeEventListener('toolbox-comment-lock-change', handleLockChange,)
		}
	}, [comment,],)

	if (!locked) { return null }

	return (
		<span
			className="locked-tagline"
			title="locked by this subreddit's moderators"
		>
			locked comment
		</span>
	)
}

/**
 * Creates handlers for the comment-lock feature.
 * @returns `commentLockRun` (injects lock buttons into unprocessed comments) and `cleanup`
 *   (unregisters the renderers, unmounts every injected button, and clears the processed markers);
 *   pass `cleanup` to `lifecycle.mount` in `index.ts`.
 */
export function createCommentLockHandlers () {
	const scope = createLifecycle()
	// Clears every `.toolbox-lock-button` marker on teardown so a re-init re-injects.
	const guard = createDisposalGuard(scope, 'toolbox-lock-button',)

	renderAtLocation(
		'thingNativeActionReplacement',
		{id: 'betterbuttons.commentLock', lifecycle: scope,},
		({context,},) => {
			const detail = context.rawDetail as CommentLockDetail | undefined
			if (detail?.type !== 'commentLock') { return null }
			return <CommentLockButton initialLocked={detail.initialLocked} comment={detail.comment} />
		},
	)

	renderAtLocation(
		'thingTaglineStatus',
		{id: 'betterbuttons.commentLockStatus', lifecycle: scope,},
		({context, target,},) => {
			if (context.kind !== 'comment') { return null }
			const comment = target.closest('.thing',)
			if (!comment) { return null }
			const initialLocked = !!comment.querySelector('.locked-tagline',)
			return <CommentLockStatus initialLocked={initialLocked} comment={comment} />
		},
	)

	function processComment (comment: Element,) {
		if (guard.isDisposed()) { return }
		if (comment.classList.contains('toolbox-lock-button',)) { return }
		comment.classList.add('toolbox-lock-button',)
		const initialLocked = !!comment.querySelector('.locked-tagline',)
		const anchor = getCommentRemoveButton(comment,)?.closest('li',)
		if (!anchor) { return }
		const li = document.createElement('li',)
		li.className = 'toolbox-replacement'
		anchor.insertAdjacentElement('afterend', li,)
		const thingId = comment.getAttribute('data-fullname',)
		const removeProvided = provideLocation('thingNativeActionReplacement', li, {
			platform: RedditPlatform.Old,
			kind: 'thingNativeAction',
			...(thingId && {thingId,}),
			rawDetail: {type: 'commentLock', comment, initialLocked,},
		}, {shadow: false, hostTag: 'span',},)
		// provideLocation only removes the host it mounts inside `li`; dispose that and the
		// outer <li> we injected here.
		scope.mount(() => {
			removeProvided()
			li.remove()
		},)
	}

	function commentLockRun () {
		void forEachChunkedDynamic(getUncheckedComments('toolbox-lock-button',), processComment,)
	}

	return {commentLockRun, cleanup: scope.cleanup,}
}
