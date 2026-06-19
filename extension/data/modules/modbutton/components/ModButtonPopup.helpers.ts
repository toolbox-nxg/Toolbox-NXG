/** Pure helpers, constants, and status-fetching logic for the ModButtonPopup component. */

import {
	getBanState,
	getContributorState,
	getModeratorListResult,
	getMuteState,
} from '../../../api/resources/relationships'
import {ActionKind, SubStatus,} from '../schema'

/** Reddit character limit for the internal ban note. */
export const maxBanReasonLength = 300
/** Reddit character limit for the ban message sent to the user. */
export const maxBanMessageLength = 5000
/** Notice appended to the ban message when "remove all content" is selected. */
export const removalNotice =
	'\n\nNote: All of your posts and comments in this subreddit have been removed as a result of this ban.'
/** Reddit character limit for user flair text. */
export const maxFlairTextLength = 64

/** Maps each action kind to the relationship it modifies and whether it adds or removes it. */
export const actionMap: Record<
	ActionKind,
	{action: 'banned' | 'contributor' | 'moderator' | 'muted'; kind: 'positive' | 'negative'}
> = {
	'ban': {action: 'banned', kind: 'negative',},
	'change ban': {action: 'banned', kind: 'negative',},
	'add submitter': {action: 'contributor', kind: 'positive',},
	'remove submitter': {action: 'contributor', kind: 'negative',},
	'mod': {action: 'moderator', kind: 'positive',},
	'demod': {action: 'moderator', kind: 'negative',},
	'mute': {action: 'muted', kind: 'negative',},
	'unmute': {action: 'muted', kind: 'positive',},
}

/** Details of an existing ban fetched from the Reddit API, shown in the ban form. */
export interface ExistingBan {
	note: string
	timestamp: Date
	/** Username of the moderator who issued the ban. */
	modName: string
	/** `/u/<modName>` profile link. */
	modLink: string
	/** Remaining days on a temporary ban, or `null` for a permanent ban. */
	daysLeft: number | null
}

/**
 * Extracts a human-readable message from an unknown thrown value.
 * @param error The caught value.
 * @returns `error.message` for `Error` instances, otherwise the value stringified.
 */
export function errorMessage (error: unknown,): string {
	return error instanceof Error ? error.message : String(error,)
}

/**
 * Returns the action that best matches the current page URL, or `null` if no special default applies.
 * For example, `/about/moderators` defaults to `'mod'`.
 */
export function getDefaultActionForUrl (): ActionKind | null {
	if (location.pathname.match(/\/about\/(?:moderator)\/?/,)) { return 'mod' }
	if (location.pathname.match(/\/about\/(?:contributors)\/?/,)) { return 'add submitter' }
	return null
}

/**
 * Returns `true` if `permissions` includes `'all'` or any of the `required` permission strings.
 * @param permissions The current user's mod permission list for a subreddit.
 * @param required One or more permission names to check for.
 */
export function hasPermission (permissions: string[], ...required: string[]): boolean {
	if (permissions.includes('all',)) { return true }
	return required.some((p,) => permissions.includes(p,))
}

/**
 * Returns `true` when the given action makes sense for a user with the given subreddit status.
 * Used to disable checkboxes for non-applicable subs.
 */
export function isActionApplicable (status: SubStatus | undefined, action: ActionKind,): boolean {
	if (!status || status.loading) { return true }
	switch (action) {
		case 'ban':
		case 'change ban':
		case 'mute':
			return !status.isMod
		case 'unmute':
			return status.isMuted
		case 'demod':
			return status.isMod
		case 'add submitter':
			return !status.isContributor
		case 'remove submitter':
			return status.isContributor
		case 'mod':
			return !status.isMod
	}
}

/** Returns a human-readable tooltip explaining why the given action is not applicable. */
export function notApplicableReason (action: ActionKind,): string {
	switch (action) {
		case 'ban':
		case 'change ban':
			return 'Cannot ban a mod'
		case 'mute':
			return 'Cannot mute a mod'
		case 'unmute':
			return 'User is not muted here'
		case 'demod':
			return 'User is not a mod here'
		case 'add submitter':
			return 'User is already a contributor here'
		case 'remove submitter':
			return 'User is not a contributor here'
		case 'mod':
			return 'User is already a mod here'
	}
}

/** Placeholder status used while a subreddit's relationship data is being fetched. */
export const loadingStatus: SubStatus = {
	loading: true,
	banned: false,
	daysLeft: null,
	isMod: false,
	isContributor: false,
	isMuted: false,
	currentUserPermissions: [],
}

/**
 * Fetches the target user's ban/contributor/mod/mute status for a subreddit in parallel.
 * @param subreddit The subreddit to check.
 * @param user The target user's username.
 * @param currentUserName The acting moderator's username (needed to look up their permissions).
 * @returns The resolved `SubStatus` and raw `banInfo` (if any).
 */
export async function fetchSubStatus (subreddit: string, user: string, currentUserName: string,) {
	const [banResult, contribResult, modResult, muteResult,] = await Promise.allSettled([
		getBanState(subreddit, user,),
		getContributorState(subreddit, user,),
		getModeratorListResult(subreddit, user, currentUserName,),
		getMuteState(subreddit, user,),
	],)
	const banInfo = banResult.status === 'fulfilled' ? banResult.value : undefined
	const isContributor = contribResult.status === 'fulfilled' ? !!contribResult.value : false
	const modData = modResult.status === 'fulfilled'
		? modResult.value
		: {targetIsMod: false, currentUserPermissions: [],}
	const isMuted = muteResult.status === 'fulfilled' ? !!muteResult.value : false
	return {
		status: {
			loading: false,
			banned: !!banInfo,
			daysLeft: banInfo?.days_left ?? null,
			isMod: modData.targetIsMod,
			isContributor,
			isMuted,
			currentUserPermissions: modData.currentUserPermissions,
		} satisfies SubStatus,
		banInfo,
	}
}
