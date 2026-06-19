/** React renderer that fetches and displays the ActionDetails table for a queue item. */
import {useEffect, useState,} from 'react'

import type {UILocationContext,} from '../../../dom/uiLocations'
import type {ActionEntry,} from '../schema'
import {ActionDetails,} from './ActionDetails'

/** Max seconds of skew tolerated between a thing's banned/approved time and the modlog's record of the same action. */
const ACTION_MATCH_TOLERANCE_SECONDS = 5

/**
 * Callback signature for the getActions function provided by the dom.ts factory.
 * Returns cached mod-log actions for a queue item, fetching from the API if needed.
 */
export type GetActions = (
	subreddit: string,
	fullName: string,
	callback: (result: Record<string, any> | false,) => void,
) => void

/**
 * Builds a synthetic ActionEntry from a post's direct approval/removal fields.
 * Returns null if the post has neither a current approval nor a current removal.
 * @param data Raw Reddit API thing data.
 * @param kind Whether the item is a post or comment.
 */
function getPostStateEntry (data: Record<string, unknown>, kind: UILocationContext['kind'],): ActionEntry | null {
	const isComment = kind === 'comment'
	if (data.approved_by && data.approved_at_utc) {
		return {
			id: '__post_state__',
			mod: data.approved_by as string,
			action: isComment ? 'approvecomment' : 'approvelink',
			details: '',
			created_utc: data.approved_at_utc as number,
		}
	}
	if (data.banned_by && data.banned_at_utc) {
		const isSpam = data.banned_by === true
		return {
			id: '__post_state__',
			mod: isSpam ? 'Reddit' : data.banned_by as string,
			action: isComment ? (isSpam ? 'spamcomment' : 'removecomment') : (isSpam ? 'spamlink' : 'removelink'),
			details: (data.ban_note as string) || '',
			created_utc: data.banned_at_utc as number,
		}
	}
	return null
}

/**
 * Fetches and displays the ActionDetails table for a queue item,
 * but only when the current user moderates the item's subreddit.
 * @param props Component properties.
 * @param context UILocationContext for the current queue item.
 * @param getActions Factory-provided function to retrieve cached mod-log actions.
 * @param checkIsMod Factory-provided check for whether the current user moderates a subreddit.
 * @param getThingData Factory-provided fetch for a thing's raw data fields.
 */
export function ActionTableRenderer (
	{context, getActions, checkIsMod, getThingData,}: {
		context: UILocationContext
		getActions: GetActions
		checkIsMod: (subreddit: string,) => Promise<boolean>
		getThingData: (thingId: string,) => Promise<Record<string, unknown>>
	},
) {
	const {thingId, subreddit, kind,} = context
	const [isMod, setIsMod,] = useState<boolean | null>(null,)
	const [actions, setActions,] = useState<Record<string, ActionEntry> | false | null>(null,)
	/** undefined = still loading; null = loaded but no current action; ActionEntry = loaded with data */
	const [postStateEntry, setPostStateEntry,] = useState<ActionEntry | null | undefined>(undefined,)

	useEffect(() => {
		if (!subreddit) { return }
		let alive = true
		checkIsMod(subreddit,).then((mod,) => {
			if (alive) { setIsMod(mod,) }
		},)
		return () => {
			alive = false
		}
	}, [subreddit, checkIsMod,],)

	useEffect(() => {
		if (!isMod || !subreddit || !thingId) { return }
		let alive = true
		getActions(subreddit, thingId, (result,) => {
			if (alive) { setActions(result as Record<string, ActionEntry> | false,) }
		},)
		return () => {
			alive = false
		}
	}, [isMod, subreddit, thingId, getActions,],)

	useEffect(() => {
		if (!isMod || !thingId) { return }
		let alive = true
		getThingData(thingId,).then((data,) => {
			if (alive) { setPostStateEntry(getPostStateEntry(data, kind,),) }
		},).catch(() => {
			if (alive) { setPostStateEntry(null,) }
		},)
		return () => {
			alive = false
		}
	}, [isMod, thingId, kind, getThingData,],)

	if (actions === null || postStateEntry === undefined) { return null }
	if (!actions && postStateEntry === null) { return null }
	if (!thingId || !subreddit) { return null }

	// Deduplicate: the post-state row is a fallback for actions the modlog doesn't cover. If the modlog
	// already records the same action (same mod + action type, with timestamps within a small tolerance),
	// drop the post-state row and keep the modlog row, whose details are richer. An exact-timestamp match
	// is too brittle: the thing's banned_at_utc/approved_at_utc and the modlog's created_utc for the same
	// action routinely differ by a second or more.
	const modlogEntries = actions ? Object.values(actions,) : []
	const isCoveredByModlog = postStateEntry !== null && modlogEntries.some((a,) =>
		a.mod === postStateEntry.mod
		&& a.action === postStateEntry.action
		&& Math.abs(a.created_utc - postStateEntry.created_utc,) <= ACTION_MATCH_TOLERANCE_SECONDS
	)
	const deduplicatedPostState = postStateEntry && !isCoveredByModlog ? postStateEntry : null

	const initialShow = document.body.classList.contains('toolbox-show-actions',)
	return <ActionDetails actions={actions || {}} initialShow={initialShow} postStateEntry={deduplicatedPostState} />
}
