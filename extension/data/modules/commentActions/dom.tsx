/** DOM integration for the Comment Actions module - registers the recreated comment controls. */

import {renderAtLocation,} from '../../dom/uiLocations'
import {CommentExtras, CommentVote,} from './components/CommentActions'

/**
 * Registers the recreated comment controls at the `thingFlatListActions` location (comment-only) and
 * returns a combined cleanup. The vote arrows register at `order: -10` so they sit FIRST - left of
 * Second opinion and the mod actions, like Reddit's native row; Reply + the ⋯ Expand toggle register
 * at `order: 20`, after the mod actions. The location context lacks the comment element, so it's read
 * from the DOM target.
 */
export function createCommentActionsSlot (): () => void {
	const cleanups = [
		renderAtLocation('thingFlatListActions', {id: 'commentActions.vote', order: -10,}, ({context, target,},) => {
			const comment = commentFor(context, target,)
			return comment ? <CommentVote comment={comment} /> : null
		},),
		renderAtLocation('thingFlatListActions', {id: 'commentActions.extras', order: 20,}, ({context, target,},) => {
			const comment = commentFor(context, target,)
			return comment ? <CommentExtras comment={comment} /> : null
		},),
	]
	return () => {
		for (const cleanup of cleanups) { cleanup() }
	}
}

/** Resolves the `shreddit-comment` for a comment-kind render, or `null` when not applicable. */
function commentFor (
	context: {kind?: string; thingId?: string; subreddit?: string},
	target: Element,
): Element | null {
	if (context.kind !== 'comment' || !context.thingId || !context.subreddit) { return null }
	return target.closest('shreddit-comment',)
}
