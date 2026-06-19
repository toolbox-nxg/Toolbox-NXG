/** Shared types and interfaces for the Queue Overlay module. */

/** The five Reddit mod-queue types surfaced by the overlay. */
export type QueueType = 'modqueue' | 'unmoderated' | 'reports' | 'spam' | 'edited'

/** Maps each queue type to the subreddit multi-string used to build its default URL. */
export type QueueBaseUrls = Record<QueueType, {
	/** Comma-separated subreddit list (or `"mod"`) passed to the Reddit API. */
	subreddits: string
}>

/** Imperative handle returned by `showQueueOverlay` for controlling a live overlay instance. */
export interface QueueOverlayHandle {
	/**
	 * Switches the active queue type, optionally scoping to a specific subreddit.
	 * @param type The queue tab to activate.
	 * @param options.subreddit When provided, reloads the tab scoped to this subreddit.
	 * @param options.overwrite When true, forces a reload even if the tab was already initialized.
	 */
	setType: (type: QueueType, options?: {subreddit?: string | undefined; overwrite?: boolean | undefined},) => void
}
