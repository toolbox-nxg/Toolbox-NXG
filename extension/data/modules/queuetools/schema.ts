/** Domain types for the Queue Tools module. */

/** A single entry from the subreddit mod log, keyed by action ID. */
export interface ActionEntry {
	id: string
	/** Username of the moderator who performed the action. */
	mod: string
	action: string
	details: string
	/** Optional free-text description attached to the mod log entry. */
	description?: string
	/** Unix timestamp (seconds) when the action was taken. */
	created_utc: number
}
