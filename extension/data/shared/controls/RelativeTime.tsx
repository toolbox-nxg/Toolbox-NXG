/** Renders a date as a relative time string (e.g. "3 hours ago"). */

import {formatRelativeTime,} from '../../util/data/time'

/** Displays a date as a relative time string (e.g. "3 hours ago"). */
export const RelativeTime = ({date,}: {
	/** Date and time to display */
	date: Date
},) => (
	<time dateTime={date.toISOString()} title={date.toLocaleString()}>
		{formatRelativeTime(date,)}
	</time>
)
