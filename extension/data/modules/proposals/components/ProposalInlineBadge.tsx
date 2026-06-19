/**
 * Inline indicator shown on a thing that has open proposals awaiting review. Clicking
 * it opens the central review drawer. Reads from the proposals cache and re-renders on
 * change; renders nothing when the item has no open proposals. For non-moderators the
 * shared count hook skips the mod-only proposals page entirely (no wiki read), so the
 * badge stays at zero without probing subreddits the viewer doesn't moderate.
 */

import {GeneralInlineButton,} from '../../../shared/controls/GeneralInlineButton'
import {Icon,} from '../../../shared/controls/Icon'
import {classes,} from '../../../util/ui/reactMount'
import css from './ProposalInlineBadge.module.css'
import {showProposalsReviewPopup,} from './ProposalsReviewPopup'
import {useItemProposalCount,} from './useItemProposalCount'

/** Inline "N proposal(s) pending" badge for a single thing. */
export function ProposalInlineBadge ({subreddit, itemId,}: {subreddit: string; itemId: string},) {
	// Count comes from a per-subreddit store shared across every badge on the page (one
	// proposals-changed subscription + one rescan per change, not one per badge).
	const count = useItemProposalCount(subreddit, itemId,)

	if (count < 1) { return null }

	return (
		<GeneralInlineButton
			className={css.badge}
			title="This item has a proposal awaiting review"
			onClick={() => showProposalsReviewPopup(subreddit,)}
		>
			<Icon icon="unknownDocument" className={classes(css.badgeIcon,)} /> {count} proposal{count > 1 ? 's' : ''}
		</GeneralInlineButton>
	)
}
