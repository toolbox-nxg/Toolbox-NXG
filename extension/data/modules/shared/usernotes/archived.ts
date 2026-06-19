/** Shared helper for setting or clearing a note's archived state. */

/**
 * Returns a copy of `note` with its `archived` state replaced. Passing no `archived` value (or a
 * falsy one) clears it, dropping the key entirely rather than leaving an `archived: undefined`.
 * @param note The note to copy.
 * @param archived The new archived metadata, or omit/falsy to unarchive.
 * @returns A new note object with the archived state applied.
 */
export function withArchived<T extends {archived?: unknown},> (note: T, archived?: T['archived'],): T {
	const {archived: _archived, ...rest} = note
	return {...rest, ...(archived && {archived,}),} as T
}
