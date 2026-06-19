/** Helper utilities for filtering and searching entries displayed in the profile overlay. */
import {literalRegExp,} from '../../../util/data/string'
import {cleanSubredditName,} from '../../../util/reddit/reddit-domain'

/** Visibility filters applied to profile listing entries in the overlay. */
export interface ProfileEntryFilters {
	/** When true, hide entries from subreddits the current user does not moderate. */
	filterModThings: boolean
	/** When true, hide entries where the author was distinguished as a moderator. */
	hideModActions: boolean
	/** Lowercase-normalized list of subreddits the current user moderates. */
	moderatedSubreddits: string[]
}

/** Raw (uncompiled) search options entered by the user in the profile overlay toolbar. */
export interface ProfileSearchOptions {
	/** Subreddit name or pattern to filter by. */
	subreddit: string
	/** Text or pattern to match against post/comment body. */
	content: string
	/** Whether the subreddit and content fields should be treated as regular expressions. */
	regex: boolean
}

/** Compiled (regex-ready) form of a profile search, produced by `compileProfileSearch`. */
export interface CompiledProfileSearch {
	/** Compiled subreddit filter, or null if no subreddit was specified. */
	subredditPattern: RegExp | null
	/** Compiled content filter, or null if no content was specified. */
	contentPattern: RegExp | null
	/** Present when the user-supplied regex string is invalid. */
	error?: string | undefined
}

/**
 * Returns all rendered profile listing entries within a container.
 * @param container The DOM element or document to search within.
 */
export function getProfileThings (container: Element | Document,): Element[] {
	return Array.from(container.querySelectorAll('.toolbox-thing',),)
}

/**
 * Strips the `r/` prefix (if any) and lowercases a subreddit name for consistent comparison.
 * @param subreddit Raw subreddit string from user input or API data.
 */
export function normalizeProfileSubreddit (subreddit: string,): string {
	return cleanSubredditName(subreddit,).toLowerCase()
}

/**
 * Applies visibility filters to all profile entries inside a container by toggling CSS classes.
 * @param container The sitetable element containing rendered profile entries.
 * @param filters Filter options controlling which entries are shown.
 * @returns The number of entries that remain visible after filtering.
 */
export function applyProfileEntryFilters (container: Element, filters: ProfileEntryFilters,): number {
	const things = getProfileThings(container,)
	const moderated = new Set(filters.moderatedSubreddits.map(normalizeProfileSubreddit,),)

	things.forEach((thing,) => {
		thing.classList.remove('toolbox-mod-hidden', 'toolbox-mod-filtered',)

		if (filters.hideModActions && thing.querySelector('.toolbox-moderator',)) {
			thing.classList.add('toolbox-mod-hidden',)
		}

		if (filters.filterModThings) {
			const subreddit = normalizeProfileSubreddit(thing.getAttribute('data-subreddit',) ?? '',)
			if (!moderated.has(subreddit,)) {
				thing.classList.add('toolbox-mod-filtered',)
			}
		}
	},)

	return things.filter((thing,) =>
		!thing.classList.contains('toolbox-mod-hidden',)
		&& !thing.classList.contains('toolbox-mod-filtered',)
	).length
}

/**
 * Compiles raw search options into `RegExp` patterns ready for matching.
 * @param options The user-supplied search options to compile.
 * @returns Compiled patterns, or an object with an `error` string if a regex is invalid.
 */
export function compileProfileSearch (options: ProfileSearchOptions,): CompiledProfileSearch {
	const subreddit = options.regex ? options.subreddit.trim() : normalizeProfileSubreddit(options.subreddit,)
	const content = options.content.trim()

	let subredditPattern: RegExp | null = null
	let contentPattern: RegExp | null = null
	try {
		if (subreddit) {
			subredditPattern = options.regex
				? new RegExp(subreddit, 'i',)
				: new RegExp(`^${literalRegExp(subreddit,).source}$`, 'i',)
		}
		if (content) {
			contentPattern = options.regex ? new RegExp(content, 'i',) : literalRegExp(content, 'i',)
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error,)
		return {subredditPattern: null, contentPattern: null, error: `Invalid regex: ${message}`,}
	}

	return {subredditPattern, contentPattern,}
}

/**
 * Returns whether a Reddit API listing entry matches a compiled profile search.
 * @param entry A raw Reddit API child object (`t1` comment or `t3` submission).
 * @param patterns The compiled subreddit and content patterns to test against.
 * @returns `false` when no patterns are provided; otherwise `true` only if all active patterns match.
 */
export function profileListingEntryMatches (
	entry: any,
	{subredditPattern, contentPattern,}: Omit<CompiledProfileSearch, 'error'>,
): boolean {
	if (!subredditPattern && !contentPattern) { return false }

	const data = entry.data ?? {}
	const subredditMatch = subredditPattern ? subredditPattern.test(data.subreddit ?? '',) : true
	let contentMatch = true

	if (contentPattern) {
		const haystacks = entry.kind === 't3'
			? [data.title, data.selftext,]
			: [data.body,]
		contentMatch = haystacks.some((value,) => contentPattern.test(value ?? '',))
	}

	return subredditMatch && contentMatch
}

/** The three listing tabs available in the profile overlay. */
export type ProfileListing = 'overview' | 'submitted' | 'comments'
/** Runtime state for a single listing tab (overview, submitted, or comments). */
export interface TabState {
	sort: string
	/** Pagination cursor for the next Reddit API page, or `false` when exhausted. */
	after: string | false
	items: any[]
	/** Whether the tab has completed its initial data load. */
	loaded: boolean
	/** Whether a search is currently active (affecting what is displayed). */
	searchActive: boolean
	searchSubreddit: string
	searchContent: string
	searchRegex: boolean
	/** Whether a search fetch loop is currently running. */
	searchRunning: boolean
	/** Number of API pages fetched so far during the current search. */
	searchPageCount: number
	/** Number of matching entries found so far during the current search. */
	searchResultCount: number
	/** Non-null when an error occurred during the last load or search. */
	error?: string | undefined
}

/** Cached listing data for a single (listing, sort) combination. */
export interface ProfilePageCache {
	/** All items fetched so far, deduplicated by fullname. */
	items: any[]
	/** Reddit API cursor for the next unfetched page, or `false` when none. */
	after: string | false
	/** `true` when the API has no more pages to fetch. */
	exhausted: boolean
	/** How many API pages have been fetched into this cache entry. */
	pageCount: number
}

/** Map from `"listing:sort"` cache keys to their cached page data. */
export type ProfileCacheStore = Record<string, ProfilePageCache>

export const defaultTabState: TabState = {
	sort: 'new',
	after: false,
	items: [],
	loaded: false,
	searchActive: false,
	searchSubreddit: '',
	searchContent: '',
	searchRegex: false,
	searchRunning: false,
	searchPageCount: 0,
	searchResultCount: 0,
}

export function getUserThumbnailUrl (aboutData: any,): string | null {
	const candidates = [
		aboutData.snoovatar_img,
		aboutData.subreddit?.icon_img,
		aboutData.icon_img,
	]

	const found = candidates.find((url: unknown,): url is string =>
		typeof url === 'string'
		&& url.trim() !== ''
	)

	return found ? found.replace(/&amp;/g, '&',) : null
}

export function getCacheKey (listing: ProfileListing, sort: string,): string {
	return `${listing}:${sort}`
}

export function entryBelongsToListing (entry: any, listing: ProfileListing,): boolean {
	return listing === 'overview'
		|| listing === 'submitted' && entry.kind === 't3'
		|| listing === 'comments' && entry.kind === 't1'
}

/**
 * Returns the cache bucket for a (listing, sort) pair, creating an empty one if absent.
 * @param store The shared cache store keyed by `"listing:sort"`.
 * @param listing The listing tab the cache belongs to.
 * @param sort The sort order the cache belongs to.
 */
export function getOrCreatePageCache (
	store: ProfileCacheStore,
	listing: ProfileListing,
	sort: string,
): ProfilePageCache {
	const key = getCacheKey(listing, sort,)
	store[key] ??= {items: [], after: false, exhausted: false, pageCount: 0,}
	return store[key]
}

/**
 * Appends a freshly fetched page of items into the cache, deduplicating by fullname.
 * @param store The shared cache store keyed by `"listing:sort"`.
 * @param listing The listing tab the page belongs to.
 * @param sort The sort order the page belongs to.
 * @param items The raw Reddit API children returned for this page.
 * @param after The Reddit cursor for the next page, or `false` when exhausted.
 * @returns The subset of `items` that were not already cached.
 */
/**
 * Filters out items whose Reddit fullname (`item.data.name`) has already been seen, adding each
 * kept item's name to `seen` so duplicates within `items` are removed too. Items without a
 * fullname are always kept and never recorded.
 * @param items Candidate listing items.
 * @param seen Set of already-seen fullnames; mutated in place as items are kept.
 * @returns The items not previously seen.
 */
export function dedupByFullname (items: any[], seen: Set<string>,): any[] {
	return items.filter((item,) => {
		const name = item.data?.name
		if (!name || !seen.has(name,)) {
			if (name) { seen.add(name,) }
			return true
		}
		return false
	},)
}

export function cacheListingPage (
	store: ProfileCacheStore,
	listing: ProfileListing,
	sort: string,
	items: any[],
	after: string | false,
): any[] {
	const cache = getOrCreatePageCache(store, listing, sort,)
	const seen = new Set(cache.items.map((item,) => item.data?.name).filter(Boolean,),)
	const newItems = items.filter((item,) => {
		const name = item.data?.name
		return !name || !seen.has(name,)
	},)
	cache.items.push(...newItems,)
	cache.after = after
	cache.exhausted = !after
	cache.pageCount += 1
	return newItems
}

/**
 * Fetches a single page of a user's listing. Matches the signature of
 * `getUserListingPage`; injected into `fetchEntireListing` so this module stays
 * free of extension-only imports (and thus unit-testable).
 */
export type ListingPageFetcher = (
	user: string,
	listing: string,
	query: Record<string, string>,
) => Promise<any>

/**
 * Eagerly fetches every remaining page of a user's listing into the cache.
 * Resumes from wherever the cache currently sits, so already-browsed pages are not re-fetched.
 * @param fetchPage Function that fetches one listing page (pass `getUserListingPage`).
 * @param user The Reddit username whose listing is fetched.
 * @param listing The listing to fetch (typically `overview` for full-history repost detection).
 * @param sort The sort order to fetch under.
 * @param store The shared cache store to populate.
 * @param onProgress Optional callback invoked after each page with the running page and item counts.
 * @param shouldCancel Optional predicate; when it returns `true` the loop stops early.
 * @returns All cached items for the (listing, sort) pair once fetching completes.
 */
export async function fetchEntireListing (
	fetchPage: ListingPageFetcher,
	user: string,
	listing: ProfileListing,
	sort: string,
	store: ProfileCacheStore,
	onProgress?: (pageCount: number, itemCount: number,) => void,
	shouldCancel?: () => boolean,
): Promise<any[]> {
	const cache = getOrCreatePageCache(store, listing, sort,)
	let after = typeof cache.after === 'string' ? cache.after : ''

	while (!cache.exhausted) {
		if (shouldCancel?.()) { break }
		// eslint-disable-next-line no-await-in-loop
		const data: any = await fetchPage(user, listing, {
			raw_json: '1',
			after: after || '',
			sort,
			limit: '100',
			t: 'all',
		},)
		const nextAfter = data.data.after || false
		cacheListingPage(store, listing, sort, data.data.children, nextAfter,)
		onProgress?.(cache.pageCount, cache.items.length,)
		if (!nextAfter) { break }
		after = nextAfter
	}

	return cache.items
}

/** Minimum length (after stripping non-alphanumerics) for a text signature to count toward repost detection. */
const MIN_REPOST_TEXT_LENGTH = 15

/**
 * Normalizes an external link into a stable signature for repost matching.
 * Lowercases the host, strips a leading `www.`, drops common tracking query params,
 * and trims trailing slashes. Returns `null` for non-HTTP(S) or unparseable URLs.
 * @param rawUrl The raw `url` field from a submission.
 */
export function normalizeRepostUrl (rawUrl: string,): string | null {
	if (!rawUrl) { return null }
	let url: URL
	try {
		url = new URL(rawUrl,)
	} catch {
		return null
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') { return null }

	const host = url.hostname.toLowerCase().replace(/^www\./, '',)
	const params = new URLSearchParams(url.search,)
	const trackingKeys = ['ref', 'ref_src', 'fbclid', 'gclid', 'igshid', 'si',]
	// Collect matching keys via forEach rather than spreading params.keys(): in
	// Firefox content scripts the iterator returned by URLSearchParams.keys() is an
	// Xray-wrapped DOM iterator with no accessible Symbol.iterator, so spreading it
	// (or for...of) throws "not iterable". forEach is a plain method and works in
	// both engines. We gather first, then delete, to avoid mutating mid-iteration.
	const keysToDelete: string[] = []
	params.forEach((_value, key,) => {
		if (/^utm_/i.test(key,) || trackingKeys.includes(key.toLowerCase(),)) {
			keysToDelete.push(key,)
		}
	},)
	for (const key of keysToDelete) {
		params.delete(key,)
	}
	const search = params.toString()
	const path = url.pathname.replace(/\/+$/, '',)
	return `${host}${path}${search ? `?${search}` : ''}`
}

/**
 * Normalizes free text (a title, selftext, or comment body) into a stable signature.
 * Lowercases and strips every non-alphanumeric character so formatting-only differences
 * collapse together. Returns `null` when the stripped result is too short to be meaningful.
 * @param text The raw text to normalize.
 */
export function normalizeRepostText (text: string,): string | null {
	if (!text) { return null }
	const stripped = text.toLowerCase().replace(/[^a-z0-9]/g, '',)
	return stripped.length >= MIN_REPOST_TEXT_LENGTH ? stripped : null
}

/** Per-entry repost annotation produced by `computeRepostGroups`. */
export interface RepostInfo {
	/** Size of the primary (largest matching) duplicate group this entry belongs to. */
	count: number
	/** True when any of the entry's duplicate groups spans more than one subreddit. */
	crossSub: boolean
	/** Whether the primary group matched on link or on text, used for the badge tooltip. */
	matchType: 'link' | 'text'
	/** Signature key of the primary group - the target a badge click isolates. */
	groupKey: string
}

/** Result of `computeRepostGroups`: per-entry annotations plus full group membership. */
export interface RepostData {
	/** Maps an entry fullname to its repost annotation (only entries that are reposts appear). */
	byFullname: Map<string, RepostInfo>
	/** Maps a signature key to the set of member fullnames (every group with >=2 members). */
	groups: Map<string, Set<string>>
}

/**
 * Detects reposts within a single user's history by grouping entries that share a
 * normalized link or text signature. An entry is a repost if it shares any signature
 * with at least one other entry.
 * @param items Raw Reddit API children (`t1` comments and/or `t3` submissions).
 * @returns Per-entry annotations and complete group membership.
 */
export function computeRepostGroups (items: any[],): RepostData {
	// signature key -> member descriptors (name + subreddit)
	const buckets = new Map<string, {name: string; subreddit: string}[]>()
	// fullname -> the signature keys it produced
	const entrySignatures = new Map<string, string[]>()

	for (const entry of items) {
		const data = entry?.data
		const name: string | undefined = data?.name
		if (!name) { continue }
		const subreddit = (data.subreddit ?? '').toLowerCase()
		const sigs: string[] = []

		if (entry.kind === 't3') {
			if (!data.is_self) {
				const linkSig = normalizeRepostUrl(data.url ?? '',)
				if (linkSig) { sigs.push(`link:${linkSig}`,) }
			}
			const titleSig = normalizeRepostText(data.title ?? '',)
			if (titleSig) { sigs.push(`text:${titleSig}`,) }
			const selfSig = normalizeRepostText(data.selftext ?? '',)
			if (selfSig) { sigs.push(`text:${selfSig}`,) }
		} else if (entry.kind === 't1') {
			const bodySig = normalizeRepostText(data.body ?? '',)
			if (bodySig) { sigs.push(`text:${bodySig}`,) }
		}

		// Title and selftext can normalize to the same key; dedupe so a single entry
		// never counts twice within one bucket.
		const uniqueSigs = [...new Set(sigs,),]
		entrySignatures.set(name, uniqueSigs,)
		for (const sig of uniqueSigs) {
			const list = buckets.get(sig,) ?? []
			list.push({name, subreddit,},)
			buckets.set(sig, list,)
		}
	}

	// A group is any signature shared by two or more distinct entries.
	const groups = new Map<string, Set<string>>()
	for (const [sig, members,] of buckets) {
		const names = new Set(members.map((member,) => member.name),)
		if (names.size >= 2) { groups.set(sig, names,) }
	}

	const byFullname = new Map<string, RepostInfo>()
	for (const [name, sigs,] of entrySignatures) {
		const memberSigs = sigs.filter((sig,) => groups.has(sig,))
		if (memberSigs.length === 0) { continue }

		// Primary group: the largest; on a tie prefer a link match over a text match.
		let primary = memberSigs[0]!
		for (const sig of memberSigs) {
			const size = groups.get(sig,)!.size
			const bestSize = groups.get(primary,)!.size
			const isLink = sig.startsWith('link:',)
			const bestIsLink = primary.startsWith('link:',)
			if (size > bestSize || size === bestSize && isLink && !bestIsLink) {
				primary = sig
			}
		}

		// Cross-sub if any of the entry's groups spans more than one subreddit.
		const crossSub = memberSigs.some((sig,) =>
			new Set(buckets.get(sig,)!.map((member,) => member.subreddit),).size > 1
		)

		byFullname.set(name, {
			count: groups.get(primary,)!.size,
			crossSub,
			matchType: primary.startsWith('link:',) ? 'link' : 'text',
			groupKey: primary,
		},)
	}

	return {byFullname, groups,}
}

/**
 * Applies repost border styling, count badges, and optional group-isolation filtering
 * to rendered profile entries. Idempotent: each call first clears prior repost markup,
 * so it is safe to re-run after new entries load or when the active group changes.
 * @param container The sitetable element containing rendered profile entries.
 * @param byFullname Per-entry repost annotations from `computeRepostGroups`.
 * @param groups Full group membership from `computeRepostGroups`.
 * @param enabled When false, repost markup is cleared and nothing is applied.
 * @param activeGroup When set, only entries in this group's membership stay visible.
 * @param showOnlyReposts When true, entries that are not reposts are hidden.
 */
export function applyRepostHighlights (
	container: Element,
	byFullname: Map<string, RepostInfo>,
	groups: Map<string, Set<string>>,
	enabled: boolean,
	activeGroup: string | null,
	showOnlyReposts: boolean,
): void {
	const things = getProfileThings(container,)
	const activeMembers = enabled && activeGroup ? groups.get(activeGroup,) ?? null : null

	things.forEach((thing,) => {
		thing.classList.remove('toolbox-repost', 'toolbox-repost-cross-sub', 'toolbox-repost-filtered',)
		thing.querySelector('.toolbox-repost-badge',)?.remove()

		if (!enabled) { return }

		const name = thing.getAttribute('data-fullname',) ?? ''
		const info = name ? byFullname.get(name,) : undefined
		if (info) {
			thing.classList.add('toolbox-repost',)
			if (info.crossSub) { thing.classList.add('toolbox-repost-cross-sub',) }

			const badge = document.createElement('span',)
			badge.className = 'toolbox-repost-badge'
			badge.setAttribute('data-repost-group', info.groupKey,)
			badge.title = info.crossSub
				? `Reposted ${info.count} times across multiple subreddits - click to show only these`
				: `Reposted ${info.count} times - click to show only these`
			badge.textContent = `Repost ×${info.count}`

			const target = thing.querySelector('.toolbox-title',) ?? thing.querySelector('.toolbox-tagline',)
			target?.appendChild(badge,)
		}

		if (activeMembers && !activeMembers.has(name,)) {
			thing.classList.add('toolbox-repost-filtered',)
		}

		// "Show only reposts" hides every entry that has no repost annotation.
		if (showOnlyReposts && !info) {
			thing.classList.add('toolbox-repost-filtered',)
		}
	},)
}
