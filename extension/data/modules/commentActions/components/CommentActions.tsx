/**
 * Recreated comment controls rendered into the Toolbox flat-list row so each comment shows a single
 * row. Two pieces, registered separately so they bracket the mod actions:
 *   - {@link CommentVote} - the vote arrows + score, rendered FIRST (leftmost, like Reddit).
 *   - {@link CommentExtras} - Reply and the ⋯ Expand toggle, rendered after the mod actions.
 *
 * The native `<shreddit-comment-action-row>` is collapsed by CSS. Voting clicks Reddit's own native
 * vote button (its working, scope-independent path - the REST `/api/vote` isn't authorized for the
 * Shreddit web token); Reply expands the native row then clicks its native reply control; Expand
 * reveals the native row inline for the controls we don't recreate (save, award, insights, share).
 * Every click stops propagation so the full-post overlay doesn't swallow it.
 */

import {useEffect, useState,} from 'react'

import {
	clickNativeVoteButton,
	getCommentActionRow,
	getNativeReplyButton,
	parseScoreAttr,
	readVoteState,
	setNativeRowExpanded,
} from '../../../dom/shreddit/commentActionRow'
import {FlatListAction,} from '../../../shared/controls/FlatListAction'
import createLogger from '../../../util/infra/logging'
import {classes,} from '../../../util/ui/reactMount'

const log = createLogger('CommentActions',)

/** A numeric vote direction: 1 up, 0 none, -1 down. */
type VoteDir = 1 | 0 | -1

/** Maps a native vote-state to a numeric direction. */
function stateToDir (state: 'UP' | 'DOWN' | 'NONE',): VoteDir {
	return state === 'UP' ? 1 : state === 'DOWN' ? -1 : 0
}

/**
 * Reads a comment's current vote (direction + score) from the native DOM, preferring the action row's
 * score - that's where the vote control lives and where Reddit updates the number on a vote - and
 * falling back to the comment element's score when the row doesn't expose one.
 */
function readCommentVote (comment: Element, actionRow: Element | null,): {score: number | null; dir: VoteDir} {
	const {state, score: rowScore,} = readVoteState(actionRow,)
	return {score: rowScore ?? parseScoreAttr(comment,), dir: stateToDir(state,),}
}

/** Props shared by the comment-control pieces. */
export interface CommentControlProps {
	/** The `shreddit-comment` element, used to read state and drive/collapse the native row. */
	comment: Element
}

/**
 * Upvote/downvote arrows with a live score. Clicking drives Reddit's native vote button and updates
 * the displayed score optimistically (reverting if the native control can't be found).
 */
export function CommentVote ({comment,}: CommentControlProps,) {
	// One atomic vote state (direction + score). Keeping the pair in a single state object means each
	// optimistic update - and its revert - is one setter call, so the arrow highlight and the displayed
	// number can never drift apart.
	const [vote, setVote,] = useState(() => readCommentVote(comment, getCommentActionRow(comment,),))

	// Reddit owns the authoritative score/vote-state on the action row; our optimistic update can drift
	// from it (a rejected vote, or a concurrent change). Mirror Reddit's values back whenever it changes
	// them, so the displayed number can't stay wrong. No-op until the native attributes actually change.
	useEffect(() => {
		const actionRow = getCommentActionRow(comment,)
		const resync = () => setVote(readCommentVote(comment, actionRow,),)
		const observer = new MutationObserver(resync,)
		observer.observe(comment, {attributes: true, attributeFilter: ['score',],},)
		if (actionRow) {
			observer.observe(actionRow, {attributes: true, attributeFilter: ['score', 'vote-state',],},)
		}
		return () => observer.disconnect()
	}, [comment,],)

	/** Toggles a vote direction: drives the native button and mirrors the result in our state. */
	function castVote (direction: 'up' | 'down',) {
		const target: VoteDir = direction === 'up'
			? (vote.dir === 1 ? 0 : 1)
			: (vote.dir === -1 ? 0 : -1)
		const prev = vote
		// Optimistic: score shifts by the change in direction (e.g. neutral->up is +1, up->down is -2).
		setVote({dir: target, score: prev.score === null ? null : prev.score + (target - prev.dir),},)
		if (!clickNativeVoteButton(comment, direction,)) {
			// The native vote control couldn't be driven (Reddit's markup changed). Don't fail
			// silently: revert the optimistic change and reveal the native row so the user can vote
			// with Reddit's own arrows instead of a dead button. (Reply degrades the same way - it
			// expands the native row before reaching for the native reply control.)
			log.warn('native vote control not found; revealing the native row as a fallback',)
			setVote(prev,)
			setNativeRowExpanded(comment, true,)
		}
	}

	return (
		<span className="toolbox-comment-vote">
			<FlatListAction
				className={classes(vote.dir === 1 && 'is-upvoted',)}
				aria-pressed={vote.dir === 1}
				title="Upvote"
				onClick={() => castVote('up',)}
			>
				▲
			</FlatListAction>
			<span className="toolbox-comment-score">{vote.score === null ? '•' : vote.score}</span>
			<FlatListAction
				className={classes(vote.dir === -1 && 'is-downvoted',)}
				aria-pressed={vote.dir === -1}
				title="Downvote"
				onClick={() => castVote('down',)}
			>
				▼
			</FlatListAction>
		</span>
	)
}

/** Reply (drives the native composer) and the ⋯ Expand toggle for the native row. */
export function CommentExtras ({comment,}: CommentControlProps,) {
	const [expanded, setExpanded,] = useState(false,)

	/** Reveal/collapse the native action row inline. */
	function toggleExpanded () {
		const next = !expanded
		setExpanded(next,)
		setNativeRowExpanded(comment, next,)
	}

	/** Opens Reddit's native inline composer by revealing the native row and clicking its Reply control. */
	function onReply () {
		setNativeRowExpanded(comment, true,)
		setExpanded(true,)
		const replyButton = getNativeReplyButton(getCommentActionRow(comment,),)
		if (replyButton) { replyButton.click() }
		else { log.warn('native reply control not found',) }
	}

	return (
		<>
			<FlatListAction title="Reply" onClick={onReply}>
				Reply
			</FlatListAction>
			<FlatListAction
				aria-pressed={expanded}
				title={expanded
					? 'Hide the native comment actions'
					: 'Show the native comment actions (save, award, share, ...)'}
				onClick={toggleExpanded}
			>
				⋯
			</FlatListAction>
		</>
	)
}
