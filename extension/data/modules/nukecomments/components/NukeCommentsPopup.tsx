/** Popup window that fetches, previews, and bulk-removes or bulk-locks a comment chain. */

import {useEffect, useRef, useState,} from 'react'

import {getCommentThread,} from '../../../api/resources/comments'
import {lock, removeThing,} from '../../../api/resources/things'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Window,} from '../../../shared/window/Window'
import store from '../../../store'
import {negativeTextFeedback, neutralTextFeedback,} from '../../../store/feedback'
import {startSpinner, stopSpinner,} from '../../../store/spinnerSlice'
import createLogger from '../../../util/infra/logging'
import {mountPopup,} from '../../../util/ui/reactMount'
import {isTrainingCaptureActive,} from '../../shared/proposals/gateway'
import type {ExecutionType,} from '../schema'

import css from './NukeCommentsPopup.module.css'

const log = createLogger('CommentNuke',)

/** Lifecycle phase of the nuke operation. */
type Phase = 'fetching' | 'ready' | 'executing' | 'done-success' | 'done-with-errors'

/** Props for the {@link NukeCommentsPopup} component. */
interface NukeCommentsPopupProps {
	/** Base-36 ID of the root comment whose chain will be nuked (without `t1_` prefix). */
	commentID: string
	/** Base-36 ID of the containing post (without `t3_` prefix). */
	postID: string
	subreddit: string
	/** Initial value for the "ignore distinguished comments" checkbox. */
	defaultIgnoreDistinguished: boolean
	/** Initial value for the remove/lock radio selection. */
	defaultExecutionType: ExecutionType
	/** Screen position where the popup should be placed when opened. */
	initialPosition: {top: number; left: number}
	onClose: () => void
}

/**
 * Recursively fetches the full comment thread and categorises comments into removal candidates
 * and distinguished comments (mod/admin), following "load more" links as needed.
 *
 * @returns An object containing `removalChain` (non-removed, non-distinguished comment IDs) and
 *   `distinguishedComments` (mod/admin distinguished comment IDs).
 */
async function parseChain (
	commentID: string,
	postID: string,
	subreddit: string,
): Promise<{removalChain: string[]; distinguishedComments: string[]}> {
	const removalChain: string[] = []
	const distinguishedComments: string[] = []

	// Recursive walk over heterogeneous comment-tree nodes (Listing / t1 / more); the broad
	// `RedditThing.kind` string makes a typed discriminated walk impractical here.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped recursive JSON walk
	async function recurse (object: any,) {
		if (!object) { return }
		switch (object.kind) {
			case 'Listing': {
				if (!Array.isArray(object.data?.children,)) { break }
				for (const child of object.data.children) {
					await recurse(child,)
				}
				break
			}
			case 't1': {
				if (!object.data) { break }
				const distinguishedType = object.data.distinguished
				if (
					(distinguishedType === 'admin' || distinguishedType === 'moderator')
					&& !distinguishedComments.includes(object.data.id,)
				) {
					distinguishedComments.push(object.data.id,)
				} else if (
					!removalChain.includes(object.data.id,)
					&& !object.data.removed
					&& !object.data.spam
				) {
					removalChain.push(object.data.id,)
				}
				if (object.data.replies && typeof object.data.replies === 'object') {
					await recurse(object.data.replies,)
				}
				break
			}
			case 'more': {
				if (!object.data) { break }
				log.debug('"load more" encountered, going even deeper',)
				let commentIDs = object.data.children
				if (!commentIDs.length) {
					commentIDs = [object.data.parent_id.substring(3,),]
				}
				for (const id of commentIDs) {
					const data = await getCommentThread(subreddit, postID, id,)
					const child = data[1]?.data?.children?.[0]
					if (child) { await recurse(child,) }
				}
				break
			}
		}
	}

	const data = await getCommentThread(subreddit, postID, commentID,)
	const rootComment = data[1]?.data?.children?.[0]
	if (rootComment) { await recurse(rootComment,) }
	return {removalChain, distinguishedComments,}
}

/**
 * Renders a draggable popup that shows the results of the comment-chain analysis and lets the
 * moderator choose to remove or lock every comment, then execute the operation.
 */
export function NukeCommentsPopup ({
	commentID,
	postID,
	subreddit,
	defaultIgnoreDistinguished,
	defaultExecutionType,
	initialPosition,
	onClose,
}: NukeCommentsPopupProps,) {
	const [phase, setPhase,] = useState<Phase>('fetching',)
	const [removalChain, setRemovalChain,] = useState<string[]>([],)
	const [distinguishedComments, setDistinguishedComments,] = useState<string[]>([],)
	const [ignoreDistinguished, setIgnoreDistinguished,] = useState(defaultIgnoreDistinguished,)
	const [executionType, setExecutionType,] = useState<ExecutionType>(defaultExecutionType,)
	const [missedComments, setMissedComments,] = useState<string[]>([],)
	const [retryExecutionType, setRetryExecutionType,] = useState<ExecutionType>(defaultExecutionType,)
	const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null,)

	// Kick off the initial fetch + parse.
	useEffect(() => {
		store.dispatch(startSpinner(),)
		parseChain(commentID, postID, subreddit,).then(({removalChain, distinguishedComments,},) => {
			store.dispatch(stopSpinner(),)
			setRemovalChain(removalChain,)
			setDistinguishedComments(distinguishedComments,)
			setPhase('ready',)
		},).catch((error: unknown,) => log.error(error,))
		return () => {
			if (autoCloseTimer.current) { clearTimeout(autoCloseTimer.current,) }
		}
	}, [],)

	const totalFound = removalChain.length + distinguishedComments.length

	const handleClose = () => {
		if (phase === 'executing') {
			negativeTextFeedback('Comment chain nuke in progress, cannot close popup.',)
			return
		}
		onClose()
	}

	const runRemoval = async (isRetry: boolean,) => {
		// Snapshot the user's choices before the first `await`: the inputs stay interactive during
		// the async training-mode check, so reading them afterwards could pick up a value the user
		// changed mid-launch. Lock in what they had selected when they hit the button.
		const launchIgnoreDistinguished = ignoreDistinguished
		const launchExecutionType = executionType

		// Bulk action - not captured in training mode; refuse up front.
		if (await isTrainingCaptureActive(subreddit,)) {
			negativeTextFeedback('Nuking comments isn\'t available in training mode',)
			onClose()
			return
		}
		setPhase('executing',)
		store.dispatch(startSpinner(),)

		let commentArray: string[]
		let currentExecutionType: ExecutionType
		if (isRetry) {
			currentExecutionType = retryExecutionType
			commentArray = missedComments
			setMissedComments([],)
		} else {
			currentExecutionType = launchExecutionType
			commentArray = launchIgnoreDistinguished
				? removalChain
				: removalChain.concat(distinguishedComments,)
		}

		const total = commentArray.length
		let processed = 0
		const newMissed: string[] = []

		await Promise.all(commentArray.map(async (comment,) => {
			processed++
			neutralTextFeedback(
				`${currentExecutionType === 'remove' ? 'Removing' : 'Locking'} comment ${processed}/${total}`,
			)
			const fullname = `t1_${comment}`
			try {
				if (currentExecutionType === 'remove') {
					await removeThing(fullname,)
				} else {
					await lock(fullname,)
				}
			} catch {
				newMissed.push(comment,)
			}
		},),)

		store.dispatch(stopSpinner(),)
		if (newMissed.length) {
			setMissedComments(newMissed,)
			setRetryExecutionType(currentExecutionType,)
			setPhase('done-with-errors',)
		} else {
			setPhase('done-success',)
			autoCloseTimer.current = setTimeout(onClose, 1500,)
		}
	}

	const feedbackText = (() => {
		switch (phase) {
			case 'fetching':
				return 'Fetching all comments belonging to chain.'
			case 'ready':
				return 'Finished analyzing comments.'
			case 'executing':
				return `${executionType === 'remove' ? 'Removing' : 'Locking'} comments.`
			case 'done-success':
				return `Done ${executionType === 'remove' ? 'removing' : 'locking'} comments.`
			case 'done-with-errors':
				return `Done ${retryExecutionType === 'remove' ? 'removing' : 'locking'} comments.`
		}
	})()

	return (
		<Window
			title="Nuke comment chain"
			draggable
			initialPosition={initialPosition}
			closable={phase !== 'executing'}
			onClose={handleClose}
			footer={
				<>
					{phase === 'ready' && (
						<ActionButton onClick={() => void runRemoval(false,)}>
							Execute
						</ActionButton>
					)}
					{phase === 'done-with-errors' && (
						<ActionButton onClick={() => void runRemoval(true,)}>
							Retry
						</ActionButton>
					)}
				</>
			}
		>
			<div className={css.popupContent}>
				<div className={css.feedback}>{feedbackText}</div>
				{phase === 'ready' && (
					<div className={css.details}>
						<p>
							{totalFound} comments found (Already removed comments not included).
						</p>
						<p>{distinguishedComments.length} distinguished comments found.</p>
						<p>
							<label>
								<input
									type="checkbox"
									checked={ignoreDistinguished}
									onChange={(event,) => setIgnoreDistinguished(event.target.checked,)}
								/>
								Ignore distinguished comments from mods and admins
							</label>
						</p>
						<p>
							<label>
								<input
									type="radio"
									name="toolbox-execution-type-radio"
									value="remove"
									checked={executionType === 'remove'}
									onChange={() => setExecutionType('remove',)}
								/>
								Remove comments
							</label>
							<label>
								<input
									type="radio"
									name="toolbox-execution-type-radio"
									value="lock"
									checked={executionType === 'lock'}
									onChange={() => setExecutionType('lock',)}
								/>
								Lock comments
							</label>
						</p>
					</div>
				)}
				{phase === 'done-with-errors' && (
					<div className={css.details}>
						{missedComments.length}: not {retryExecutionType === 'remove' ? 'removed' : 'locked'}{' '}
						because of API errors. Hit retry to attempt removing them again.
					</div>
				)}
			</div>
		</Window>
	)
}

/**
 * Mounts a {@link NukeCommentsPopup} in a React portal and returns a cleanup function.
 * The optional `onClose` prop in `props` is called in addition to the portal's own cleanup.
 */
export function showNukeCommentsPopup (
	props: Omit<NukeCommentsPopupProps, 'onClose'> & {onClose?: () => void},
) {
	// Per-target by the comment chain being nuked, so re-clicking the same nuke button
	// reveals the live popup instead of stacking a duplicate.
	return mountPopup(
		(onClose,) => <NukeCommentsPopup {...props} onClose={onClose} />,
		props.onClose,
		`nukecomments:${props.postID}:${props.commentID}`,
	)
}
