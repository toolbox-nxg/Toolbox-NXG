/** DOM integration for the Proposals module - registers the modbar review button. */

import {renderAtLocation,} from '../../dom/uiLocations'
import {ProposalInlineBadge,} from './components/ProposalInlineBadge'
import {ProposalsButton,} from './components/ProposalsButton'
import {SecondOpinionToggle,} from './components/SecondOpinionToggle'
import {TrainingModeIndicator,} from './components/TrainingModeIndicator'

/**
 * Registers the Proposals modbar button and returns its cleanup function. Pass the
 * return value to `lifecycle.mount()` in `index.ts`. Renders into the modbar's
 * counter group (immediately left of the modmail icon) so it reads as one of the
 * mod queue counters rather than a labelled button.
 */
export function createProposalsModbarSlot (): () => void {
	return renderAtLocation(
		'modbarCounters',
		{id: 'proposals.review', order: 0,},
		() => <ProposalsButton />,
	)
}

/**
 * Registers the per-thing inline "proposal pending" badge and returns its cleanup
 * function. Renders nothing for items without open proposals.
 */
export function createProposalsInlineBadgeSlot (): () => void {
	return renderAtLocation(
		'thingFlatListActions',
		{id: 'proposals.inlineBadge',},
		({context,},) => {
			if (!context.thingId || !context.subreddit) { return null }
			return <ProposalInlineBadge subreddit={context.subreddit} itemId={context.thingId} />
		},
	)
}

/**
 * Registers the modbar "Training mode" indicator and returns its cleanup function.
 * Renders into the right-hand counter group, immediately left of the proposals icon
 * (which registers at order 0); shows only for trainees on a subreddit page they're
 * sandboxed in.
 */
export function createTrainingModeIndicatorSlot (): () => void {
	return renderAtLocation(
		'modbarCounters',
		{id: 'proposals.trainingMode', order: -1,},
		() => <TrainingModeIndicator />,
	)
}

/**
 * Registers the per-thing inline "second opinion" toggle and returns its cleanup
 * function. Renders nothing for already-removed items, non-moderators, or items that
 * already have an open proposal (the inline badge covers that case).
 */
export function createProposalsSecondOpinionSlot (): () => void {
	return renderAtLocation(
		'thingFlatListActions',
		{id: 'proposals.secondOpinion',},
		({context,},) => {
			if (context.isRemoved) { return null }
			if (!context.thingId || !context.subreddit) { return null }
			return <SecondOpinionToggle subreddit={context.subreddit} itemId={context.thingId} />
		},
	)
}
