/** DOM integration for the Subreddit Notes module - registers the modbar button that opens the notes popup. */
import {renderAtLocation,} from '../../dom/uiLocations'
import {SubredditNotesButton,} from './components/SubredditNotesButton'
import type {SubredditNotesSettings,} from './settings'

/**
 * Registers the Subreddit Notes modbar button and returns its cleanup function.
 * Pass the return value to `lifecycle.mount()` in `index.ts`.
 */
export function createNotesModbarSlot (s: SubredditNotesSettings,): () => void {
	return renderAtLocation(
		'modbarContent',
		{id: 'subredditnotes.notes', order: 1,},
		() => <SubredditNotesButton {...s} />,
	)
}
