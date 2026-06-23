/**
 * Modbar button that opens the cross-subreddit proposals review drawer, with a badge
 * counting what needs the user's attention: open proposals to review plus their own
 * resolved-but-unacknowledged proposals, summed across every subreddit they moderate.
 *
 * The button shows whenever the user moderates any subreddit, so they can reach their
 * global queue from anywhere. To honor the "don't scan every wiki on modbar render"
 * rule, the badge never fans out itself: it counts only from the session cache (warm
 * after the drawer's lazy fan-out), plus a single read of the current subreddit so its
 * count shows immediately. The full cross-sub scan happens when the drawer opens, and
 * the resulting cache updates flow back here via proposals-changed events.
 */

import {useEffect, useRef, useState,} from 'react'

import {getCurrentUser,} from '../../../api/resources/me'
import {getModSubs,} from '../../../api/resources/modSubs'
import {Icon,} from '../../../shared/controls/Icon'
import {postSite,} from '../../../util/reddit/pageContext'
import {getCachedProposals, onProposalsChanged,} from '../../shared/proposals/events'
import {loadProposals,} from '../../shared/proposals/moduleapi'
import {myUnacknowledgedResolvedAcross, openProposalCountAcross,} from '../../shared/proposals/selectors'
import type {SubredditProposals,} from '../../shared/proposals/selectors'
import {sameSub,} from '../../shared/proposals/subreddits'
import {showProposalsReviewPopup,} from './ProposalsReviewPopup'

/** Modbar entry point for the proposals review popup. */
export function ProposalsButton () {
	const subreddit = postSite
	const [count, setCount,] = useState(0,)
	const [show, setShow,] = useState(false,)
	const closeRef = useRef<(() => void) | null>(null,)

	useEffect(() => {
		let cancelled = false
		// Identity (moderated subs + username) is stable for this effect's lifetime, so
		// resolve it once rather than re-fetching on every proposals-changed event; recount
		// then just reads the cache and recomputes.
		let subs: string[] = []
		let user = ''

		/** Recomputes the badge from the session cache only (no wiki fan-out). */
		function recount () {
			if (cancelled) { return }
			if (subs.length === 0) {
				setShow(false,)
				return
			}
			setShow(true,)
			// Only subreddits already in the cache contribute; uncached subs count as 0
			// until the drawer's fan-out warms them.
			const entries: SubredditProposals[] = subs.flatMap((subreddit,) => {
				const data = getCachedProposals(subreddit,)
				return data ? [{subreddit, data,},] : []
			},)
			setCount(openProposalCountAcross(entries,) + myUnacknowledgedResolvedAcross(entries, user,).length,)
		}

		void (async () => {
			;[subs, user,] = await Promise.all([
				getModSubs().catch(() => [] as string[]),
				getCurrentUser().catch(() => ''),
			],)
			if (cancelled) { return }
			// Warm just the current subreddit (a single read) so its count is visible
			// without opening the drawer; skip when it isn't one the user moderates.
			// Warm under the canonical name from getModSubs so the cache key matches the
			// one `recount` reads (page-context case may differ from the canonical case).
			const current = subreddit ? subs.find((s,) => sameSub(s, subreddit,)) : undefined
			if (current) {
				await loadProposals(current,).catch(() => {},)
			}
			if (cancelled) { return }
			recount()
		})()

		const off = onProposalsChanged(() => {
			recount()
		},)
		return () => {
			cancelled = true
			off()
		}
	}, [subreddit,],)

	if (!show) { return null }

	const handleClick = () => {
		if (closeRef.current) {
			closeRef.current()
			closeRef.current = null
			return
		}
		closeRef.current = showProposalsReviewPopup(subreddit ?? '', () => {
			closeRef.current = null
		},)
	}

	// Rendered as an icon + count pair to match the sibling modmail/modqueue
	// counters: an "unknown document" glyph and an always-present badge (0 when
	// there is nothing to review), both opening the cross-sub review drawer.
	return (
		<>
			<a
				title="proposals"
				className="toolbox-icons toolbox-proposals"
				onClick={handleClick}
			>
				<Icon icon="unknownDocument" />
			</a>
			<a className="toolbox-proposalscount" onClick={handleClick}>
				<span className="toolbox-counter-badge">{count}</span>
			</a>
		</>
	)
}
