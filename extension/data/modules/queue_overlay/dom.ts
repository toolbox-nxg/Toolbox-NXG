/** DOM integration for the Queue Overlay module - builds click handlers that open the overlay. */
import {notifier,} from '../../framework/moduleIds'
import {getSettingAsync,} from '../../util/persistence/settings'
import {showQueueOverlay,} from './components/QueueOverlay'
import {QueueBaseUrls, QueueType,} from './schema'

/** Event handlers created by `createQueueOverlayHandlers` for lifecycle delegation. */
export interface QueueOverlayHandlers {
	/** Intercepts modqueue button clicks to open the overlay instead of navigating. */
	handleModqueueClick: (target: Element, event: Event,) => void
	/** Handles the custom `tb:mysubs-open-queue` event dispatched by other modules. */
	handleOpenQueueEvent: (event: Event,) => void
	/** Intercepts unmoderated button clicks to open the overlay instead of navigating. */
	handleUnmoderatedClick: (target: Element, event: Event,) => void
	/** Handles clicks on elements with `data-type` and `data-subreddit` to open a specific queue. */
	handleSubredditQueueClick: (target: Element, event: Event,) => void
	/** Programmatically opens the overlay for a specific subreddit and queue type. */
	openSubredditQueue: (subreddit: string, type: 'modqueue' | 'unmoderated',) => void
}

/**
 * Asynchronously creates the queue overlay event handlers, loading subreddit lists from settings.
 * @returns The fully initialized handler object.
 */
export async function createQueueOverlayHandlers (): Promise<QueueOverlayHandlers> {
	const [modSubreddits, unmoderatedSubreddits,] = await Promise.all([
		getSettingAsync(notifier, 'modSubreddits', 'mod',),
		getSettingAsync(notifier, 'unmoderatedSubreddits', 'mod',),
	],)

	const baseUrls: QueueBaseUrls = {
		modqueue: {subreddits: modSubreddits,},
		unmoderated: {subreddits: unmoderatedSubreddits,},
		reports: {subreddits: modSubreddits,},
		spam: {subreddits: modSubreddits,},
		edited: {subreddits: modSubreddits,},
	}

	function openOverlay (type: QueueType, options: {subreddit?: string | undefined} = {},) {
		showQueueOverlay({initialType: type, initialSubreddit: options.subreddit, baseUrls,},)
	}

	return {
		handleModqueueClick (_target, event,) {
			if ((event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) { return }
			event.preventDefault()
			openOverlay('modqueue',)
		},
		handleUnmoderatedClick (_target, event,) {
			if ((event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) { return }
			event.preventDefault()
			openOverlay('unmoderated',)
		},
		handleSubredditQueueClick (target, event,) {
			if ((event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) { return }
			event.preventDefault()
			if (!(target instanceof HTMLElement)) { return }
			const dataType = target.getAttribute('data-type',)
			if (!dataType) { return }
			openOverlay(dataType as QueueType, {
				subreddit: target.getAttribute('data-subreddit',) ?? undefined,
			},)
		},
		openSubredditQueue (subreddit, type,) {
			openOverlay(type, {subreddit,},)
		},
		handleOpenQueueEvent (event,) {
			event.preventDefault()
			const {subreddit, type,} = (event as CustomEvent<{subreddit: string; type: 'modqueue' | 'unmoderated'}>)
				.detail
			openOverlay(type, {subreddit,},)
		},
	}
}
