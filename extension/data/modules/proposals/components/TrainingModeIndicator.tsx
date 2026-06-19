/**
 * Modbar indicator shown when the current user is a trainee on the subreddit they're
 * viewing. It signals that their moderation actions on this subreddit are captured as
 * proposals for another moderator to review rather than taking effect immediately - the
 * counterpart to the per-thing capture the gateway performs. Renders nothing off a
 * subreddit page or for non-trainees.
 *
 * Rendered as a graduation-cap glyph in the modbar's right-hand counter group (just left
 * of the proposals icon) so it reads as a sibling of the modmail/modqueue/proposals
 * counters; the trainee explanation lives in its tooltip.
 */

import {useEffect, useState,} from 'react'

import {Icon,} from '../../../shared/controls/Icon'
import {postSite,} from '../../../util/reddit/pageContext'
import {isTraineeFor,} from '../../shared/proposals/traineeState'

/** Renders the modbar "Training mode" chip for trainees on the current subreddit. */
export function TrainingModeIndicator () {
	const subreddit = postSite
	const [isTrainee, setIsTrainee,] = useState(false,)

	useEffect(() => {
		if (!subreddit) {
			setIsTrainee(false,)
			return
		}
		let cancelled = false
		void isTraineeFor(subreddit,).then((value,) => {
			if (!cancelled) { setIsTrainee(value,) }
		},)
		return () => {
			cancelled = true
		}
	}, [subreddit,],)

	if (!subreddit || !isTrainee) { return null }

	return (
		<a
			className="toolbox-icons toolbox-training-mode"
			title={`Training mode: you are a trainee in /r/${subreddit}. Your moderation actions here are `
				+ 'captured as proposals for another moderator to review instead of taking effect immediately.'}
		>
			<Icon icon="trainingMode" />
		</a>
	)
}
