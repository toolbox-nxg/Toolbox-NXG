/**
 * Typed message contracts for the Toolbox background service worker.
 *
 * Each action has a named request type. Callers and handlers import from here
 * so action strings and payload shapes are checked in one place.
 */

/** Serialized fetch response: constructor arguments that can be sent over the message channel. */
export type SerializedResponse = [string, ResponseInit,]

// --- HTTP request proxy ----------------------------------------------------

/** Message sent by content scripts to ask the background to perform an HTTP request. */
export interface TbRequestMessage {
	action: 'toolbox-request'
	method?: string | undefined
	endpoint: string
	query?: Record<string, string | number | boolean | undefined> | undefined
	body?: Record<string, string | undefined> | string | {type: 'json'; data: unknown} | undefined
	oauth?: boolean | undefined
	okOnly?: boolean | undefined
	absolute?: boolean | undefined
}

/**
 * Reply shape for a `toolbox-request` message.
 * On success, `response` holds the serialized fetch response.
 * On error, `error` is `true` and `message` describes what went wrong.
 */
export type TbRequestResponse =
	| {error?: never; response: SerializedResponse}
	| {error: true; message?: string; response?: SerializedResponse}

// --- Cache -----------------------------------------------------------------

/** Retrieves a cached value for `storageKey`; `inputValue` is the uncached fallback to store on a miss. */
interface TbCacheGetMessage {
	action: 'toolbox-cache'
	method: 'get'
	storageKey: string
	inputValue: unknown
}

/** Writes `inputValue` into the cache under `storageKey`. */
interface TbCacheSetMessage {
	action: 'toolbox-cache'
	method: 'set'
	storageKey: string
	inputValue: unknown
}

/** Clears all entries from the cache. */
interface TbCacheClearMessage {
	action: 'toolbox-cache'
	method: 'clear'
}

/** Union of all cache operation messages. */
export type TbCacheMessage = TbCacheGetMessage | TbCacheSetMessage | TbCacheClearMessage

/** Forces all TTL-governed cache entries to expire immediately. */
export interface TbCacheForceTimeoutMessage {
	action: 'toolbox-cache-force-timeout'
}

// --- Settings --------------------------------------------------------------

/** Applies a partial settings update: merges new values and removes deleted keys. */
export interface TbUpdateSettingsMessage {
	action: 'toolbox-update-settings'
	/** Keys and new values to write into `tbsettings`. */
	updatedSettings?: Record<string, unknown>
	/** Keys to remove from `tbsettings`. */
	deletedSettings?: string[]
}

/** Replaces the entire `tbsettings` object in storage with `newSettings`. */
export interface TbOverwriteAllSettingsMessage {
	action: 'toolbox-overwrite-all-settings'
	/** The full settings object to write; must be a plain object. */
	newSettings: Record<string, unknown>
}

// --- Notifications ---------------------------------------------------------

/** Payload describing a notification to display. */
export interface TbNotificationDetails {
	/** Heading text. */
	title: string
	/** Body text. */
	body: string
	/** URL to open when the notification is clicked. */
	url: string
	/**
	 * Optional stable identifier. Notifications sharing a `dedupeKey` collapse
	 * into a single notification (the same browser notification id / in-page id
	 * is reused), which suppresses cross-tab duplicates when two tabs raise a
	 * notification for the same underlying item.
	 */
	dedupeKey?: string
}

/** Requests the background to show a notification. */
export interface TbNotificationMessage {
	action: 'toolbox-notification'
	/** If `true`, displays a native browser notification; otherwise an in-page overlay. */
	native: boolean
	details: TbNotificationDetails
}

/** Notifies the background that an in-page notification was clicked. */
export interface TbPageNotificationClickMessage {
	action: 'toolbox-page-notification-click'
	/** The notification's UUID. */
	id: string
}

/** Notifies the background that an in-page notification was dismissed. */
export interface TbPageNotificationClearMessage {
	action: 'toolbox-page-notification-clear'
	/** The notification's UUID. */
	id: string
}

// --- Misc ------------------------------------------------------------------

/** Requests the background to call `browser.runtime.reload()`. */
export interface TbReloadMessage {
	action: 'toolbox-reload'
}

/** Broadcasts an event to all open Reddit tabs (and optionally the background). */
export interface TbGlobalMessage {
	action: 'toolbox-global'
	/** The event name to re-dispatch in each tab. */
	globalEvent: string
	/** Optional data to include with the event. */
	payload?: unknown
	/** If `true`, the background page is skipped and only tabs receive the event. */
	excludeBackground?: boolean
}

/** Asks the background whether a given thing is currently in a subreddit's modqueue. */
export interface TbModqueueMessage {
	action: 'toolbox-modqueue'
	subreddit: string
	/** Fullname of the thing to look up (e.g. `t3_abc123`). */
	thingName: string
	/** Unix seconds timestamp of the thing; used to detect stale cache entries. */
	thingTimestamp: number
}

// --- Usernotes decompression -----------------------------------------------

/** Asks the background to decompress a usernotes wiki blob and return the parsed user map. */
export interface TbUsernoteDecompressMessage {
	action: 'toolbox-usernote-decompress'
	/**
	 * Cache key for in-memory caching and deduplication: the subreddit for the
	 * legacy page, or a per-shard `subreddit#shard` key for sharded NXG pages.
	 */
	cacheKey: string
	/** Base64-encoded zlib-compressed JSON blob from the usernotes wiki page. */
	blob: string
}

/**
 * Reply shape for a `toolbox-usernote-decompress` message.
 * On success, `users` is the parsed user-to-notes map.
 * On failure, `error` is a stringified error description.
 */
export type TbUsernoteDecompressResponse =
	| {users: Record<string, unknown>}
	| {error: string}

// --- Union -----------------------------------------------------------------

/** Union of all messages handled by the background service worker. */
export type ToolboxMessage =
	| TbRequestMessage
	| TbCacheMessage
	| TbCacheForceTimeoutMessage
	| TbUpdateSettingsMessage
	| TbOverwriteAllSettingsMessage
	| TbNotificationMessage
	| TbPageNotificationClickMessage
	| TbPageNotificationClearMessage
	| TbReloadMessage
	| TbGlobalMessage
	| TbModqueueMessage
	| TbUsernoteDecompressMessage

/** Union of all valid `action` strings for background messages. */
export type ToolboxMessageAction = ToolboxMessage['action']
