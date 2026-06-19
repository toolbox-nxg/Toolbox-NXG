/** Business logic for polling mod queues and modmail, and dispatching browser notifications when counts increase. */

import browser from 'webextension-polyfill'

import type {TbGlobalMessage,} from '../../background/messages'

import {getModmailUnreadCount,} from '../../api/resources/modmail'
import {getModerationQueueListing,} from '../../api/resources/subreddits'
import {getInfo,} from '../../api/resources/things'
import {getTime,} from '../../util/data/time'
import createLogger from '../../util/infra/logging'
import {events,} from '../../util/reddit/events'
import {notification,} from '../../util/ui/notifications'
import {NotifierSettings,} from './settings'
import {updateCounters,} from './store'

/**
 * Minimal storage interface required by {@link createNotifierHandlers}.
 * Typed against {@link NotifierSettings} so only valid setting keys can be read or written.
 * `Module<NotifierSettings>` satisfies this interface structurally.
 */
export interface NotifierStorage {
	get<K extends keyof NotifierSettings & string,>(key: K,): Promise<NotifierSettings[K]>
	set<K extends keyof NotifierSettings & string,>(key: K, value: NotifierSettings[K],): Promise<unknown>
}

declare global {
	interface WindowEventMap {
		TB_UPDATE_COUNTERS: CustomEvent
	}
}

const log = createLogger('Notifier',)

/**
 * Coerces an unknown stored value to Record<string, number> for modmail category counts.
 * Returns an empty object if the value is null, not an object, or an array.
 */
export function toModmailCategoryCount (value: unknown,): Record<string, number> {
	if (typeof value === 'object' && value !== null && !Array.isArray(value,)) {
		return value as Record<string, number>
	}
	return {}
}

function calculateModmailCount (countData: Record<string, number>,): number {
	const excludedDirs = ['highlighted',]
	return Object.entries(countData,).reduce(
		(sum, [key, count,],) => excludedDirs.includes(key,) ? sum : sum + count,
		0,
	)
}

function processMqComments (mqlinkid: string, mqreportauthor: string, mqidname: string,) {
	getInfo<{permalink: string; title: string; subreddit: string}>(mqlinkid,).then((info,) => {
		const {permalink, title, subreddit,} = info.data
		if (!permalink || !title || !subreddit) {
			log.warn('getInfo returned incomplete data for link', mqlinkid,)
			return
		}
		notification(
			`Modqueue - /r/${subreddit} - comment: `,
			`${mqreportauthor}'s comment in: ${title}`,
			`${permalink + mqidname.substring(3,)}?context=3`,
		)
	},).catch((error: unknown,) => log.error(error,))
}

/**
 * Builds a consolidated notification body from an array of per-item labels.
 * Displays up to `cap` labels explicitly; additional items are counted as overflow.
 * @returns The notification body text and the number of overflow items not shown.
 */
function buildConsolidatedBody (labels: string[], cap = 7,): {body: string; xmore: number} {
	let body = ''
	let xmore = 0
	for (let i = 0; i < labels.length; i++) {
		if (i < cap) {
			body += labels[i]!
		} else {
			xmore++
		}
	}
	return {body, xmore,}
}

/**
 * Builds and fires the single summary notification for a moderation queue's
 * consolidated-messages mode: a body of per-item lines (via {@link buildConsolidatedBody})
 * plus an "and: X more items" tail when the list was truncated. No-op when there are no
 * new items. Shared by the modqueue and unmoderated polls, which differ only in the
 * options below.
 * @param labels Pre-formatted per-item summary lines; their count drives the title.
 * @param opts.singularTitle Notification title when there is exactly one new item.
 * @param opts.pluralNoun Noun phrase for the plural title (`${count} ${pluralNoun}`).
 * @param opts.moreSuffix Trailing text after "more items" in the overflow tail. Preserves
 *   the two callers' historically-differing whitespace (a stray space in the modqueue one).
 * @param opts.url The notification's click-through URL.
 */
function notifyConsolidated (
	labels: string[],
	opts: {
		singularTitle: string
		pluralNoun: string
		moreSuffix: string
		url: string
	},
): void {
	const count = labels.length
	if (count === 0) { return }
	const {singularTitle, pluralNoun, moreSuffix, url,} = opts
	const {body, xmore,} = buildConsolidatedBody(labels,)
	const fullBody = xmore > 0 ? `${body}\n and: ${xmore.toString()} more items${moreSuffix}` : body
	notification(count === 1 ? singularTitle : `${count.toString()} ${pluralNoun}`, fullBody, url,)
}

/** Runtime options passed to {@link createNotifierHandlers}. */
export interface ModbarCounterOptions {
	/** Whether to fire browser notifications for new modqueue items. */
	modNotifications: boolean
	/** Whether to fire browser notifications for new unmoderated items. */
	unmoderatedNotifications: boolean
	/** When `true`, multiple new items are combined into a single notification instead of one per item. */
	consolidatedMessages: boolean
	/** Multireddit string for the modqueue counter (e.g. `"mod"`). */
	modSubreddits: string
	/** Multireddit string for the unmoderated counter. */
	unmoderatedSubreddits: string
	/** Whether the unmoderated counter is visible in the modbar. */
	unmoderatedOn: boolean
	/** Polling interval in milliseconds. */
	checkIntervalMillis: number
	/** Last known modqueue count, used to detect increases. */
	modqueueCount: number
	/** Last known unmoderated count, used to detect increases. */
	unmoderatedCount: number
	/** Last known total unread modmail count. */
	modmailCount: number
	/** Per-category unread modmail counts. */
	modmailCategoryCount: Record<string, number>
}

/** Callbacks returned by {@link createNotifierHandlers}. */
export interface NotifierHandlers {
	/** Checks for new modqueue/modmail items and updates counters; throttled by the check interval. */
	getmessages: () => Promise<void>
	/**
	 * Handles a `TB_UPDATE_COUNTERS` event dispatched from the background script.
	 * If the event has no detail, forces a fresh API fetch; otherwise syncs counters from the payload.
	 */
	handleCounterUpdate: (event: CustomEvent,) => void
}

/**
 * Creates polling and event-handling functions for the Notifier module.
 * @param options Runtime configuration (intervals, subreddits, initial counts, etc.).
 * @param module Storage adapter for persisting counts and timestamps between poll cycles.
 */
export function createNotifierHandlers (
	options: ModbarCounterOptions,
	module: NotifierStorage,
): NotifierHandlers {
	let {
		modqueueCount,
		unmoderatedCount,
		modmailCount,
		modmailCategoryCount,
	} = options

	const {
		modNotifications,
		unmoderatedNotifications,
		consolidatedMessages,
		modSubreddits,
		unmoderatedSubreddits,
		unmoderatedOn,
		checkIntervalMillis,
	} = options

	let newLoad = true
	let now = new Date().getTime()

	const updateAllTabs = async () => {
		log.debug('updating all counters accross tabs',)
		await browser.runtime.sendMessage(
			{
				action: 'toolbox-global',
				globalEvent: events.TB_UPDATE_COUNTERS,
				excludeBackground: true,
				payload: {
					modqueueCount: await module.get('modqueueCount',),
					unmoderatedCount: await module.get('unmoderatedCount',),
					modmailCount: await module.get('modmailCount',),
					modmailCategoryCount: await module.get('modmailCategoryCount',),
				},
			} satisfies TbGlobalMessage,
		)
	}

	const getmessages = async () => {
		log.debug('getting messages',)

		const lastChecked = await module.get('lastChecked',)

		now = getTime()

		modqueueCount = await module.get('modqueueCount',)
		unmoderatedCount = await module.get('unmoderatedCount',)
		modmailCount = await module.get('modmailCount',)
		modmailCategoryCount = toModmailCategoryCount(await module.get('modmailCategoryCount',),)

		if (!newLoad && now - lastChecked < checkIntervalMillis) {
			updateCounters({modqueueCount, unmoderatedCount, modmailCount, modmailCategoryCount,},)
			return
		}

		newLoad = false

		let updateCountdown = unmoderatedOn ? 3 : 2
		const finishCounterUpdate = () => {
			updateCountdown--
			if (updateCountdown === 0) {
				updateAllTabs()
			}
		}

		module.set('lastChecked', now,)

		const modQueueURL = `/r/${modSubreddits}/about/modqueue`

		getModerationQueueListing({
			subreddits: modSubreddits,
			page: 'modqueue',
			limit: 100,
		},).then(async (json: any,) => {
			const count = json.data.children.length || 0
			// Bucket the aggregate listing's items by subreddit so the "subreddits you
			// moderate" drawer can show a per-sub badge without firing its own requests.
			// Counts share the aggregate's fetch limit, so they may undercount once the
			// combined queue exceeds `limit` items.
			const modqueueBySubreddit: Record<string, number> = {}
			for (const child of json.data.children as any[]) {
				const sub = child.data.subreddit
				if (typeof sub !== 'string' || !sub) { continue }
				const key = sub.toLowerCase()
				modqueueBySubreddit[key] = (modqueueBySubreddit[key] ?? 0) + 1
			}
			updateCounters({modqueueCount: count, modqueueBySubreddit,},)

			if (modNotifications && count > modqueueCount) {
				const pusheditems = await module.get('modqueuePushed',)
				if (consolidatedMessages) {
					const newItems = json.data.children.filter((v: any,) => !pusheditems.includes(v.data.name,))
					const labels = newItems.map((v: any,) => {
						const {author, subreddit,} = v.data
						return v.kind === 't3'
							? `post from: ${author}, in: ${subreddit}\n`
							: `comment from: ${author}, in: ${subreddit}\n`
					},)
					for (const v of newItems) {
						pusheditems.push(v.data.name,)
					}
					notifyConsolidated(labels, {
						singularTitle: 'One new modqueue item!',
						pluralNoun: 'new modqueue items!',
						moreSuffix: ' \n',
						url: modQueueURL,
					},)
				} else {
					json.data.children.forEach((value: any,) => {
						if (pusheditems.includes(value.data.name,)) {
							return
						}
						if (value.kind === 't3') {
							const mqpermalink = value.data.permalink
							const mqtitle = value.data.title
							const mqauthor = value.data.author
							const mqsubreddit = value.data.subreddit

							notification(
								`Modqueue: /r/${mqsubreddit} - post`,
								`${mqtitle} By: ${mqauthor}`,
								mqpermalink,
							)
						} else {
							const reportauthor = value.data.author
							const idname = value.data.name
							processMqComments(value.data.link_id, reportauthor, idname,)
						}
						pusheditems.push(value.data.name,)
					},)
				}
				// Items are pushed to the end, so oldest are at index 0. Removing
				// from the front keeps the 100 most-recently-seen item IDs.
				if (pusheditems.length > 100) {
					pusheditems.splice(0, pusheditems.length - 100,)
				}
				module.set('modqueuePushed', pusheditems,)
			}
			module.set('modqueueCount', count,)
		},).catch((error: unknown,) => {
			log.error(error,)
		},).finally(finishCounterUpdate,)

		if (unmoderatedOn || unmoderatedNotifications) {
			const unModeratedURL = `/r/${unmoderatedSubreddits}/about/unmoderated`

			getModerationQueueListing({
				subreddits: unmoderatedSubreddits,
				page: 'unmoderated',
				limit: 100,
			},).then(async (json: any,) => {
				const count = json.data.children.length || 0

				if (unmoderatedNotifications && count > unmoderatedCount) {
					const lastSeen = await module.get('lastSeenUnmoderated',)

					if (consolidatedMessages) {
						const newItems = json.data.children.filter(
							(v: any,) => !lastSeen || v.data.created_utc * 1000 > lastSeen,
						)
						const labels = newItems.map(
							(v: any,) => `post from: ${v.data.author}, in: ${v.data.subreddit}\n`,
						)
						notifyConsolidated(labels, {
							singularTitle: 'One new unmoderated item!',
							pluralNoun: 'new unmoderated items!',
							moreSuffix: '\n',
							url: unModeratedURL,
						},)
					} else {
						json.data.children.forEach((value: any,) => {
							if (!lastSeen || value.data.created_utc * 1000 > lastSeen) {
								const uqpermalink = value.data.permalink
								const uqtitle = value.data.title
								const uqauthor = value.data.author
								const uqsubreddit = value.data.subreddit

								notification(
									`Unmoderated: /r/${uqsubreddit} - post`,
									`${uqtitle} By: ${uqauthor}`,
									uqpermalink,
								)
							}
						},)
					}

					module.set('lastSeenUnmoderated', now,)
				}

				module.set('unmoderatedCount', count,)

				if (unmoderatedOn) {
					updateCounters({unmoderatedCount: count,},)
				}
			},).catch((error: unknown,) => {
				log.error(error,)
			},).finally(() => {
				if (unmoderatedOn) {
					finishCounterUpdate()
				}
			},)
		}

		getModmailUnreadCount().then(async (data,) => {
			const modmailFreshCount = calculateModmailCount(data,)
			module.set('modmailCount', modmailFreshCount,)
			module.set('modmailCategoryCount', data,)
			updateCounters({modmailCount: modmailFreshCount, modmailCategoryCount: data,},)
		},).catch((error: unknown,) => {
			log.error(error,)
		},).finally(finishCounterUpdate,)
	}

	const handleCounterUpdate = (event: CustomEvent,) => {
		if (!event.detail) {
			// requestCounterRefresh() fired with no detail - force a live re-fetch
			module.set('lastChecked', 0,)
				.then(() => getmessages())
				.catch((error: unknown,) => log.error(error,))
			return
		}
		log.debug('updating counters from background',)
		const {modqueueCount, unmoderatedCount, modmailCount, modmailCategoryCount,} = event.detail
		updateCounters({modqueueCount, unmoderatedCount, modmailCount, modmailCategoryCount,},)
	}

	return {getmessages, handleCounterUpdate,}
}
