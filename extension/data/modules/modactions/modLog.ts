/**
 * The mod-log entry projection the inline mod-actions feature reads. Reddit's `about/log` does not
 * reliably filter by a single fullname, so the recent-actions store (which decides whether the "Recent
 * actions" button is worth showing) and the item-history popup the button opens both fetch a recent
 * window via the shared `getModLogEntries<ModLogEntry>` and filter it in memory by this shape.
 */

import type {RedditModLogEntry,} from '../../api/resources/subreddits'

/** One mod-log entry, narrowed to the fields the inline mod-actions feature reads. */
export interface ModLogEntry extends RedditModLogEntry {
	/** Free-text detail for some actions (e.g. ban duration); often empty. */
	details: string | null
	/** Fullname of the targeted thing (`t3_...`/`t1_...`); used to filter to a single item. */
	target_fullname?: string
}
