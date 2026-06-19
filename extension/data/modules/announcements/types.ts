/** Shared types for the Announcements module (the wiki note shape and its wrapper). */

/** A single announcement note fetched from the wiki. */
export interface AnnouncementNote {
	/** Stable slug used as the deduplication key in seenNotes. */
	id: string
	/** Short headline shown as the popup title. */
	title: string
	/** Plain-text body (1-3 sentences; no markdown). */
	body: string
	/**
	 * Go-live time as a Unix timestamp in **epoch seconds**. Serves three roles:
	 * it is the date shown under the headline, and the display gate - a note whose
	 * `publishAt` is in the future stays hidden on every client until then
	 * (client-side scheduling). Set automatically at publish time (now, or a
	 * chosen future time). Optional only for forward-compatibility; published
	 * notes always carry it.
	 */
	publishAt?: number
	/** Optional URL opened in a new tab from the popup footer. */
	link?: string
	/** Label for the link button. Defaults to "Read more". */
	linkLabel?: string
	/**
	 * Optional allowlist of build types that should see this note.
	 * Omit to show on all builds. Dev is intentionally excluded - the display
	 * path is a no-op on dev builds, so a dev-targeted note could never show.
	 */
	buildTypes?: Array<'stable' | 'beta'>
}

/** The wrapper object stored at the announcements wiki page. */
export interface AnnouncementsWikiData {
	version: 1
	notes: AnnouncementNote[]
}
