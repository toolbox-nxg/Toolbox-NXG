/** Hook resolving whether the current user moderates a subreddit. */

import {useEffect, useState,} from 'react'

import {isModSub,} from '../../api/resources/modSubs'

/**
 * Resolves whether the current user is a moderator of `subreddit`. Returns `null` while the cached
 * check is in flight, then `true`/`false` (failing closed to `false` if the lookup rejects).
 *
 * Backs {@link IsModGuard} and any inline control that must both gate on mod status *and* read the
 * resolved value (e.g. to kick off follow-up work only once the user is known to be a mod).
 * @param subreddit Bare subreddit name (no `r/` prefix).
 */
export function useIsMod (subreddit: string,): boolean | null {
	const [isMod, setIsMod,] = useState<boolean | null>(null,)

	useEffect(() => {
		let alive = true
		isModSub(subreddit,).then((mod,) => {
			if (alive) { setIsMod(mod,) }
		},).catch(() => {
			if (alive) { setIsMod(false,) }
		},)
		return () => {
			alive = false
		}
	}, [subreddit,],)

	return isMod
}
