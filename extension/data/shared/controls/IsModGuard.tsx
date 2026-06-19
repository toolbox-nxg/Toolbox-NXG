/** Guard component that renders children only when the current user is a moderator of `subreddit`. */

import {useIsMod,} from './useIsMod'

/**
 * Renders `children` only when the current user is a moderator of `subreddit`.
 * Returns `null` while the moderation status is being fetched or if the user is not a mod.
 */
export function IsModGuard ({subreddit, children,}: {subreddit: string; children: React.ReactNode},) {
	const isMod = useIsMod(subreddit,)

	if (!isMod) { return null }
	return <>{children}</>
}
