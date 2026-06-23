/** Custom hook that paginates through a subreddit's mod log and streams results in batches. */

import {useEffect, useRef,} from 'react'
import {getModLogByPath,} from '../../../api/resources/subreddits'
import type {RedditListing,} from '../../../api/resources/subreddits'
import createLogger from '../../../util/infra/logging'
import type {ModLogEntry,} from '../schema'

/** The `data` envelope of a paginated mod-log listing response. */
type ModLogPageData = RedditListing<{kind: string; data: ModLogEntry}>['data']

const log = createLogger('ModMatrix',)
const limit = 500
const maxRetries = 3

/**
 * Fetches all mod-log entries for the given subreddit and date range, streaming results in
 * pages of up to 500 entries and invoking callbacks as data arrives.
 *
 * The fetch only runs when `enabled` is `true`; it stops and cleans up when the component unmounts
 * or `enabled` becomes `false`.
 *
 * @param subredditUrl Absolute URL of the subreddit (e.g. `https://www.reddit.com/r/example/`).
 * @param minDate Earliest timestamp to include, in milliseconds, or `null` for no lower bound.
 * @param maxDate Latest timestamp to include, in milliseconds, or `null` for no upper bound.
 * @param onBatch Called for each page of results as it arrives.
 * @param onComplete Called once after the last page has been processed.
 * @param onError Called if an unrecoverable API error occurs.
 * @param enabled Set to `true` to start (or restart) the fetch; `false` to skip.
 */
export function useModLogFetch (
	subredditUrl: string | null,
	minDate: number | null,
	maxDate: number | null,
	onBatch: (entries: ModLogEntry[], hasMore: boolean,) => void,
	onComplete: () => void,
	onError: () => void,
	enabled: boolean,
) {
	const afterRef = useRef<string | null>(null,)
	const iterationsRef = useRef(0,)
	const dataCacheRef = useRef<Record<string, ModLogPageData>>({},)
	const activeRef = useRef(false,)

	useEffect(() => {
		if (!enabled || !subredditUrl) { return }

		afterRef.current = null
		iterationsRef.current = 0
		dataCacheRef.current = {}
		activeRef.current = true

		const relativeUrl = subredditUrl.replace(/https?:\/\/[^/]+\.reddit\.com/, '',)
		const modLogCachePath = `${relativeUrl}about/log.json`

		async function fetchPage (retries = 0,): Promise<void> {
			if (!activeRef.current) { return }

			const count = iterationsRef.current * limit
			iterationsRef.current += 1

			const requestData: Record<string, string> = {limit: String(limit,), count: String(count,),}
			if (afterRef.current != null) {
				requestData.after = afterRef.current
			}

			const cacheKey = `${modLogCachePath}?${JSON.stringify(requestData,)}`
			log.debug(`Fetching ${count} to ${count + limit}`,)

			let data: ModLogPageData
			try {
				const cached = dataCacheRef.current[cacheKey]
				if (cached != null) {
					data = cached
				} else {
					const response = await getModLogByPath<{kind: string; data: ModLogEntry}>(relativeUrl, requestData,)
					data = response.data
					dataCacheRef.current[cacheKey] = data
				}
			} catch (err: unknown) {
				const status = err instanceof Object && 'response' in err
					? (err as {response?: {status?: number}}).response?.status
					: undefined
				if (status === 504 && retries < maxRetries) {
					log.debug('504 - retrying...',)
					return fetchPage(retries + 1,)
				}
				if (activeRef.current) {
					onError()
				}
				return
			}

			if (!activeRef.current) { return }

			const entries: ModLogEntry[] = []
			let finished = false

			for (const child of (data.children ?? [])) {
				const item = child.data
				if (minDate != null && minDate > item.created_utc * 1000) {
					finished = true
					break
				}
				if (maxDate != null && maxDate < item.created_utc * 1000) { continue }
				entries.push(item,)
			}

			if (data.after == null || data.after === afterRef.current) {
				finished = true
			} else {
				afterRef.current = data.after
			}

			onBatch(entries, !finished,)

			if (finished) {
				onComplete()
			} else {
				await fetchPage(0,)
			}
		}

		void fetchPage()

		return () => {
			activeRef.current = false
		}
		// Intentionally depends only on `enabled`: handleGenerate dispatches SET_DATE_RANGE
		// and START_FETCH atomically (React 18 batching), so subredditUrl/minDate/maxDate and
		// the inline callbacks are all current the moment this effect first runs for a given
		// fetch session. The button is disabled while loading, so enabled never flips
		// true->true without a false in between.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled,],)
}
