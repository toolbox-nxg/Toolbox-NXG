/**
 * Cross-module entry point for opening the removal-reasons overlay. The overlay opener is a
 * closure inside {@link createRemovalReasonsHandlers} (it captures the module's settings + open-
 * overlay registry), so it is registered here at init and other modules call {@link
 * openRemovalReasonOverlay} instead of reaching into removalreasons internals. Mirrors the
 * provider-injection pattern used by the proposals gateway (`setCurrentUserProvider`).
 */

/** Options accepted by the removal-reasons overlay opener. */
export interface OpenRemovalOverlayOptions {
	/** Fullname of the thing to remove (`t3_...`/`t1_...`). */
	thingID: string
	/** Subreddit the thing belongs to (no `r/` prefix). */
	thingSubreddit: string
	/** Whether the thing is a comment (vs a post). */
	isComment: boolean
	/** Remove as spam (trains the spam filter) rather than a plain removal. */
	spam?: boolean
}

type Opener = (options: OpenRemovalOverlayOptions,) => void

let opener: Opener | null = null

/**
 * Registers the live overlay opener (called once when the removalreasons handlers initialize) and
 * cleared on teardown. Injectable so tests and other modules need not import the handlers factory.
 * @param fn The opener, or `null` to unregister.
 */
export function setRemovalOverlayOpener (fn: Opener | null,): void {
	opener = fn
}

/**
 * Opens the removal-reasons overlay for a thing. A no-op when the removalreasons module is not
 * active (no opener registered), so callers never need to guard on it.
 * @param options Which thing to remove, and whether to remove it as spam.
 */
export function openRemovalReasonOverlay (options: OpenRemovalOverlayOptions,): void {
	opener?.(options,)
}
