/** Domain types and constants for the Subreddit Notes module. */

/** Wiki page name for the note index. */
export const subredditNotesIndexPage = 'notes/index'

/** Current schema version written to every NXG index save. */
export const subredditNotesIndexVersion = 2

/**
 * Schema version written to the legacy `notes/index` page, which older
 * toolbox builds read. v1 carries only the notes array; the v2 aggregate
 * fields are stripped on the way out (see `encodeLegacyIndex`).
 */
export const subredditNotesLegacyIndexVersion = 1

/** Metadata record stored in the note index for each note. */
export interface SubredditNoteMeta {
	slug: string
	title: string
	createdAt: number
	updatedAt: number
	archived: boolean
	tags: string[]
	/** Reddit username of the mod who created this note. Absent on notes migrated from older formats. */
	author?: string | undefined
}

/** Top-level structure of the note index wiki page (schema v2). */
export interface SubredditNoteIndex {
	version: number
	notes: SubredditNoteMeta[]
	/** Sorted unique tag list, recomputed on every save so filters don't rescan `notes`. */
	tags: string[]
	/** Sorted unique author list, recomputed on every save. */
	authors: string[]
}

/** The legacy (v1) index shape written to the old `notes/index` page: notes only, no aggregates. */
export interface SubredditNoteIndexV1 {
	version: number
	notes: SubredditNoteMeta[]
}

/** Sort order for the note list. */
export type SubredditNoteSort = 'title' | 'updated'
