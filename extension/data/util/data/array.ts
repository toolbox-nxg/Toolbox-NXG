/** Utility functions for array manipulation and sorting. */

/**
 * Returns a new array of objects sorted in descending order by the given property.
 * The input array is not mutated.
 */
export function sortBy<T,> (array: T[], property: keyof T,): T[] {
	return [...array,].sort((a, b,) => {
		if (a[property] < b[property]) {
			return 1
		}
		if (a[property] > b[property]) {
			return -1
		}
		return 0
	},)
}

/**
 * Because normal .sort() is case sensitive.
 */
export function saneSort (array: string[],): string[] {
	return array.sort((a, b,) => {
		if (a.toLowerCase() < b.toLowerCase()) {
			return -1
		}
		if (a.toLowerCase() > b.toLowerCase()) {
			return 1
		}
		return 0
	},)
}

/** Case-insensitive descending sort (z -> a). */
export function saneSortDescending (array: string[],): string[] {
	return saneSort(array,).reverse()
}
