/** Custom hook that fetches the 20 most recent mod-log entries for a specific moderator/action pair. */

import {useEffect, useState,} from 'react'
import {getModLogByPath,} from '../../../api/resources/subreddits'
import type {ModLogEntry,} from '../schema'

/**
 * Fetches up to 20 recent mod-log entries for the given moderator and action type.
 * Re-fetches whenever `subredditUrl`, `actionCode`, or `mod` changes.
 * @param subredditUrl Absolute URL of the subreddit (e.g. `https://www.reddit.com/r/example/`).
 * @param actionCode Reddit API action type code (e.g. `removelink`).
 * @param mod Username of the moderator.
 * @returns `entries` (null while loading) and `error`.
 */
export function useDrilldownFetch (
	subredditUrl: string,
	actionCode: string,
	mod: string,
): {entries: ModLogEntry[] | null; error: boolean} {
	const [entries, setEntries,] = useState<ModLogEntry[] | null>(null,)
	const [error, setError,] = useState(false,)

	useEffect(() => {
		let active = true
		const relativeUrl = subredditUrl.replace(/https?:\/\/[^/]+\.reddit\.com/, '',)
		getModLogByPath<{data: ModLogEntry}>(relativeUrl, {type: actionCode, mod, limit: '20',},)
			.then((result,) => {
				if (!active) { return }
				setEntries((result.data?.children ?? []).map((c,) => c.data),)
			},)
			.catch(() => {
				if (!active) { return }
				setError(true,)
			},)
		return () => {
			active = false
		}
	}, [subredditUrl, actionCode, mod,],)

	return {entries, error,}
}
