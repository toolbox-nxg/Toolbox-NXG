/** Shared filter-state utilities for the Mod Log Matrix filter panels. */

/**
 * Returns whether a single `item` is currently shown under the given filter.
 * @param current Active filter array, or `null` meaning all items are shown.
 * @param item The item to test.
 */
export function isFilterItemChecked (current: string[] | null, item: string,): boolean {
	return current === null || current.includes(item,)
}

/**
 * Returns the updated filter after toggling a single `item` in or out of the active set.
 * Returns `null` (meaning "show all") whenever the result would include every item in `all`.
 *
 * @param current Active filter array, or `null` meaning all items are currently shown.
 * @param all Complete list of all possible items.
 * @param item The item being toggled.
 * @param add `true` to add the item; `false` to remove it.
 */
export function toggleFilterItem (
	current: string[] | null,
	all: string[],
	item: string,
	add: boolean,
): string[] | null {
	if (add && current === null) { return null }
	const base = current ?? all
	const next = add
		? base.includes(item,) ? base : [...base, item,]
		: base.filter((c,) => c !== item)
	return next.length >= all.length ? null : next
}
