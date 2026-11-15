/**
 * Modbar indicator for the current user's training status on the subreddit they're
 * viewing. For trainees it signals that their moderation actions here are captured as
 * proposals for another moderator to review rather than taking effect immediately - the
 * counterpart to the per-thing capture the gateway performs. For a moderator without wiki
 * permission it instead explains why the wiki-backed toolbox features are unavailable
 * (their actions are live). Renders nothing otherwise.
 *
 * Rendered as a glyph in the modbar's right-hand counter group (just left of the
 * proposals icon) so it reads as a sibling of the modmail/modqueue/proposals counters;
 * the explanation lives in its tooltip.
 */

import {Icon,} from '../../../shared/controls/Icon'
import {postSite,} from '../../../util/reddit/pageContext'
import {useLoaded,} from '../../../util/ui/hooks'
import {getTrainingStatus, type TrainingStatus,} from '../../shared/proposals/traineeState'

/** Builds the tooltip explaining a visible status. */
function describeStatus (status: Exclude<TrainingStatus, 'none'>, subreddit: string,): string {
	switch (status) {
		case 'trainee':
			return `Training mode: you are a trainee in /r/${subreddit}. Your moderation actions here are `
				+ 'captured as proposals for another moderator to review instead of taking effect immediately.'
		case 'noWikiAccess':
			return `You don't have the wiki permission in /r/${subreddit}. Toolbox keeps its settings, removal `
				+ 'reasons, usernotes, and training data in the subreddit wiki, so those features are unavailable '
				+ 'here. Your moderation actions still work normally. Ask a moderator with full permissions to '
				+ 'grant you the wiki permission.'
	}
}

/** The training status for `subreddit`, or `'none'` when there is no subreddit. */
function loadTrainingStatus (subreddit: string,): Promise<TrainingStatus> {
	return subreddit ? getTrainingStatus(subreddit,) : Promise.resolve('none',)
}

/** Renders the modbar training-status chip for the current subreddit. */
export function TrainingModeIndicator () {
	const subreddit = postSite
	const loaded = useLoaded(subreddit, loadTrainingStatus,)
	// Nothing shows until the status is known (or when there's no subreddit).
	const status: TrainingStatus = loaded.status === 'ready' ? loaded.value : 'none'

	if (!subreddit || status === 'none') { return null }

	const noWiki = status === 'noWikiAccess'
	return (
		<a
			className={noWiki ? 'toolbox-icons toolbox-no-wiki-access' : 'toolbox-icons toolbox-training-mode'}
			title={describeStatus(status, subreddit,)}
		>
			<Icon icon={noWiki ? 'unknownDocument' : 'trainingMode'} />
		</a>
	)
}
