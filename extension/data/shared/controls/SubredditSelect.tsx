/** Single-select dropdown populated from the user's moderated subreddits. */

import {getModSubs,} from '../../api/resources/modSubs'
import {useFetched,} from '../../util/ui/hooks'
import {ActionSelect,} from './ActionSelect'

/**
 * Renders a single-select dropdown of the user's moderated subreddits.
 * Shows the current value as a fallback option while loading.
 * @param props Component properties.
 * @param value Currently selected subreddit name.
 * @param onChange Called with the new subreddit name when the selection changes.
 */
export const SubredditSelect = ({
	value,
	onChange,
}: {
	value: string
	onChange: (value: string,) => void
},) => {
	const modSubs = useFetched(getModSubs(false,),) as string[] | undefined
	const isLoading = modSubs === undefined

	// Build the option list: always include the current value so it shows during load
	const options = modSubs ?? (value ? [value,] : [])

	return (
		<ActionSelect
			value={value}
			disabled={isLoading}
			onChange={(e,) => onChange(e.target.value,)}
		>
			{!value && <option value="">Select a subreddit...</option>}
			{options.map((subreddit,) => <option key={subreddit} value={subreddit}>{subreddit}</option>)}
		</ActionSelect>
	)
}
