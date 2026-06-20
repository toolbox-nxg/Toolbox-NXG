/**
 * One-click "apply suggested removal" button injected on queue items whose report matches a
 * subreddit's `oneClick` suggested-reason mapping. Delegates the actual removal to the
 * removalreasons module via {@link applySuggestedRemoval}, so training-mode/second-opinion
 * capture and the full removal pipeline (message, flair, log) are reused unchanged.
 */

import {useState,} from 'react'

import {applySuggestedRemoval,} from '../../removalreasons/suggestedRemovalApplier'

/** Props for the suggested-removal button. */
interface SuggestedRemovalButtonProps {
	/** Fullname of the thing to remove (`t3_...`/`t1_...`). */
	thingID: string
	/** Subreddit the thing belongs to (no `r/` prefix). */
	thingSubreddit: string
	/** Whether the thing is a comment (vs a post). */
	isComment: boolean
	/** Persistent removal-reason ids to apply, in suggestion order. */
	reasonIds: string[]
}

type ButtonState = 'idle' | 'working' | 'removed' | 'review'

/** Renders the one-click suggested-removal button and reflects the action's outcome. */
export function SuggestedRemovalButton ({
	thingID,
	thingSubreddit,
	isComment,
	reasonIds,
}: SuggestedRemovalButtonProps,) {
	const [state, setState,] = useState<ButtonState>('idle',)

	if (state === 'removed' || state === 'review') {
		return (
			<span className="toolbox-suggested-removal-done">
				{state === 'removed' ? 'removed' : 'sent for review'}
			</span>
		)
	}

	return (
		<button
			type="button"
			className="toolbox-suggested-removal-button"
			disabled={state === 'working'}
			onClick={async () => {
				setState('working',)
				const result = await applySuggestedRemoval({thingID, thingSubreddit, isComment, reasonIds,},)
				if (result.ok) {
					setState(result.captured ? 'review' : 'removed',)
				} else {
					setState('idle',)
				}
			}}
		>
			{state === 'working' ? 'applying...' : 'Apply suggested removal'}
		</button>
	)
}
