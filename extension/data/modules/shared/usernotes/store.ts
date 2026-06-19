/** Lightweight pub/subreddit store for subreddit usernote state, used to keep note tags in sync across the page. */

import {createKeyedStore,} from '../../../util/data/pubsub'
import type {UserNoteColor, UserNotesData,} from '../../../util/wiki/schemas/usernotes/schema'

/** The current note data and color config for a subreddit, plus an error flag if loading failed. */
export interface SubredditNoteState {
	notes: UserNotesData
	colors: UserNoteColor[]
	/** True when the notes could not be loaded or the schema version is unsupported. */
	error?: boolean
}

type NoteListener = (state: SubredditNoteState,) => void

const store = createKeyedStore<SubredditNoteState>()

/** Returns the current cached note state for a subreddit, or undefined if notes have not been loaded yet. */
export function getSubredditNotes (subreddit: string,): SubredditNoteState | undefined {
	return store.get(subreddit,)
}

/**
 * Updates the note state for a subreddit and notifies all active subscribers.
 * @param subreddit The subreddit whose note state is being published.
 * @param state The new note state to publish.
 */
export function publishSubredditNotes (subreddit: string, state: SubredditNoteState,): void {
	store.publish(subreddit, state,)
}

/**
 * Subscribes to note state changes for a subreddit.
 * @returns An unsubscribe function that removes this listener.
 */
export function subscribeSubredditNotes (subreddit: string, listener: NoteListener,): () => void {
	return store.subscribe(subreddit, listener,)
}
