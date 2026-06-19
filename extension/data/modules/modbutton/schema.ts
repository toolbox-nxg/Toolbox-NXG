/** Domain types and service interfaces for the Mod Button module. */

/** Default ban-duration preset buttons shown in the ban form (days). */
export const DEFAULT_BAN_PRESETS: number[] = [3, 7, 30,]

/**
 * All write operations and cross-module reads the ModButtonPopup needs.
 * Implemented by the parent (ModButtonUserRoot) so the popup remains presentational.
 */
export interface ModButtonActions {
	/** Bans a user from a subreddit. */
	ban(
		params: {
			user: string
			subreddit: string
			note: string
			banMessage: string
			banDuration: number
			banContext: string
		},
	): Promise<void>
	/** Unbans a user from a subreddit. */
	unban(subreddit: string, user: string,): Promise<void>
	/** Adds a user as a contributor to a subreddit. */
	addContributor(subreddit: string, user: string,): Promise<void>
	/** Removes a user as a contributor from a subreddit. */
	removeContributor(subreddit: string, user: string,): Promise<void>
	/** Adds a user as a moderator of a subreddit. */
	addModerator(subreddit: string, user: string,): Promise<void>
	/** Removes a user as a moderator from a subreddit. */
	removeModerator(subreddit: string, user: string,): Promise<void>
	/** Mutes a user in a subreddit. */
	muteUser(params: {user: string; subreddit: string; duration: number},): Promise<void>
	/** Unmutes a user in a subreddit. */
	unmuteUser(subreddit: string, user: string,): Promise<void>
	/** Removes all of a banned user's content from a subreddit (used with permanent bans). */
	removeAllUserContent(subreddit: string, user: string,): Promise<void>
	/** Sets a user's flair in a subreddit. */
	flairUser(
		params: {user: string; subreddit: string; text: string; cssClass: string; templateID: string},
	): Promise<void>
	/** Sends a modmail message to a user. */
	sendModmail(
		params: {subreddit: string; to: string; subject: string; body: string; isAuthorHidden: boolean},
	): Promise<void>
	/** Loads ban macro defaults from the subreddit wiki config. */
	getBanMacros(subreddit: string,): Promise<BanMacros | null>
	/** Returns the latest ban note from usernotes for a user in a subreddit, or null if none. */
	suggestBanNote(subreddit: string, user: string,): Promise<string | null>
	/** Refreshes notification counters after batch actions. */
	refreshCounters(): void
}

/** Ban macro configuration stored in the subreddit toolbox wiki page. */
export interface BanMacros {
	/** Internal mod note pre-filled into the ban form. */
	banNote: string
	/** Ban message pre-filled into the ban form (sent to the user). */
	banMessage: string
	/** Whether the ban defaults to permanent. */
	defaultBanPermanent: boolean
	/** Default temporary ban duration in days (0 means permanent or not set). */
	defaultBanDuration: number
	/** Quick-select duration buttons shown in the ban form (days, 1-999). */
	banDurationPresets: number[]
}

/** The relationship actions the mod button can perform on a user. */
export type ActionKind =
	| 'ban'
	| 'change ban'
	| 'add submitter'
	| 'remove submitter'
	| 'mod'
	| 'demod'
	| 'mute'
	| 'unmute'

/** Per-subreddit status of the target user and current user's permissions. */
export interface SubStatus {
	loading: boolean
	banned: boolean
	daysLeft: number | null
	isMod: boolean
	isContributor: boolean
	isMuted: boolean
	/** Current user's mod permissions. Empty until loaded. `['all']` = full permissions. */
	currentUserPermissions: string[]
}
