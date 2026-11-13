/** Pure helpers for the HistoryPopup subreddit tables. */

/**
 * Sorts table entries by count, highest first, optionally moving one key to the front.
 * @param entries Key/value pairs, e.g. from `Object.entries`.
 * @param countOf Reads the count each entry is ranked by.
 * @param pinnedKey The key to move to the front, or null for plain count order.
 * @returns A new array; the input is not modified.
 */
export function sortByCountWithPinned<T,> (
	entries: [string, T,][],
	countOf: (value: T,) => number,
	pinnedKey: string | null,
): [string, T,][] {
	const sorted = [...entries,].sort(([_, a,], [__, b,],) => countOf(b,) - countOf(a,))
	const pinnedIndex = pinnedKey === null ? -1 : sorted.findIndex(([key,],) => key === pinnedKey)
	if (pinnedIndex <= 0) { return sorted }
	const [pinned,] = sorted.splice(pinnedIndex, 1,)
	return pinned ? [pinned, ...sorted,] : sorted
}
