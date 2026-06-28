/** Domain types and normalizers for the Modmail user-sidebar activity panel. */

/** Which kind of recent-activity map an entry came from, controlling how its fields map onto the view model. */
export type SidebarActivityKind = 'post' | 'comment' | 'convo'

/** A single normalized row rendered in the user-sidebar activity panel. */
export interface SidebarActivityItem {
	/** Stable key for the row (the source map's key: a fullname or conversation id). */
	id: string
	/** Primary line: post title, the comment's post title, or the conversation subject. */
	title: string
	/** Link target for the row (absolute or site-relative Reddit URL). */
	permalink: string
	/** Subreddit the post/comment belongs to, when present. */
	subreddit?: string
	/** Comment body, present only for comment rows. */
	body?: string
	/** Parsed timestamp, when the entry carried a valid date. */
	date?: Date
}

function asRecord (value: unknown,): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function asString (value: unknown,): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asDate (value: unknown,): Date | undefined {
	if (typeof value !== 'string' && typeof value !== 'number') { return undefined }
	const date = new Date(value,)
	return Number.isNaN(date.getTime(),) ? undefined : date
}

/**
 * Defensively narrows one of the `recent*` maps from the modmail `/user` response into a
 * date-descending list of view rows. Untyped/malformed entries are skipped rather than thrown.
 * @param map The raw keyed map (`recentPosts`, `recentComments`, or `recentConvos`).
 * @param kind Which map this is, selecting how `title`/`body` are derived.
 */
export function normalizeRecentActivity (map: unknown, kind: SidebarActivityKind,): SidebarActivityItem[] {
	const record = asRecord(map,)
	if (!record) { return [] }

	const items: SidebarActivityItem[] = []
	for (const [id, rawEntry,] of Object.entries(record,)) {
		const entry = asRecord(rawEntry,)
		if (!entry) { continue }

		const permalink = asString(entry.permalink,)
		if (!permalink) { continue }

		const title = kind === 'convo' ? asString(entry.subject,) : asString(entry.title,)
		const date = asDate(entry.date,)
		const subreddit = asString(entry.subreddit,)
		const body = kind === 'comment' ? asString(entry.comment,) : undefined

		items.push({
			id,
			title: title ?? '(no title)',
			permalink,
			...subreddit ? {subreddit,} : {},
			...body ? {body,} : {},
			...date ? {date,} : {},
		},)
	}

	// Most recent first; entries lacking a parseable date sort to the end.
	return items.sort((a, b,) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
}
