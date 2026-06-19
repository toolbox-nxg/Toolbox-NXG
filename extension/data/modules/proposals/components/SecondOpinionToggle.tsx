/**
 * Inline "second opinion" toggle shown on a thing's action row. When armed, the
 * moderator's next moderation action on the item (approve, remove, lock, a removal-reason
 * send, ...) is captured as a second-opinion proposal for another moderator to review
 * instead of being performed live - the gateway consults the shared review-mode flag at
 * its capture chokepoint. The flag is one-shot: it clears once an action is captured.
 *
 * It complements {@link ProposalInlineBadge}: the toggle shows only while the item has no
 * open proposal, and the badge shows once one exists, so the row never displays both.
 */

import {useSyncExternalStore,} from 'react'

import {FlatListAction,} from '../../../shared/controls/FlatListAction'
import {useIsMod,} from '../../../shared/controls/useIsMod'
import {positiveTextFeedback,} from '../../../store/feedback'
import {classes,} from '../../../util/ui/reactMount'
import {isMarkedForReview, subscribeReviewMode, toggleReviewMode,} from '../../shared/proposals/reviewMode'
import css from './SecondOpinionToggle.module.css'
import {useItemProposalCount,} from './useItemProposalCount'

/** Props for the inline second-opinion toggle. */
interface Props {
	/** The subreddit the thing belongs to. */
	subreddit: string
	/** Fullname of the post/comment to arm for review. */
	itemId: string
}

/** Renders the inline second-opinion toggle when appropriate. */
export function SecondOpinionToggle ({subreddit, itemId,}: Props,) {
	// Shared per-subreddit count: while > 0 the badge (not this toggle) is shown.
	const count = useItemProposalCount(subreddit, itemId,)
	// Armed state for this item, shared with the gateway via the review-mode store.
	const armed = useSyncExternalStore(subscribeReviewMode, () => isMarkedForReview(itemId,),)
	// Only moderators of the sub may request review; `null` until the cached check resolves.
	const isMod = useIsMod(subreddit,)

	if (isMod !== true || count > 0) { return null }

	/** Arms/disarms the item; nudges the moderator when arming so the next action is expected. */
	function onToggle () {
		const next = !armed
		toggleReviewMode(itemId,)
		if (next) {
			positiveTextFeedback('Second opinion armed - your next action on this item goes to review',)
		}
	}

	// Styled with the shared `toolbox-flat-list-action` pill class (via {@link FlatListAction}) so it
	// matches the other flat-list-slot controls (Approve, Remove, the inline mod actions); `css.armed`
	// layers the on-state green/bold on top. The pill rules are scoped via `:host`, so they reach this
	// shadow-mounted link.
	return (
		<FlatListAction
			className={classes(css.toggle, armed && css.armed,)}
			aria-pressed={armed}
			title={armed
				? 'Armed: your next action on this item will be captured for review. Click to cancel.'
				: 'Arm: capture your next action on this item for another moderator to review'}
			onClick={onToggle}
		>
			{armed ? 'Second opinion: on' : 'Second opinion'}
		</FlatListAction>
	)
}
