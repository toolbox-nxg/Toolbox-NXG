/** Settings definitions for the Subreddit Notes module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'noteWiki',
			sharedPolicy: 'populated',
			description: 'Default subreddit to use for shared mod notes.',
			type: 'modsub',
			default: '',
		},
		{
			id: 'defaultToCurrentSub',
			type: 'boolean',
			default: false,
			description: 'When on a subreddit you moderate, default to opening notes for that subreddit',
		},
		{
			id: 'monospace',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Use a monospace font in the text editor',
		},
		{
			id: 'renderMarkdown',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Render markdown in the note view (off shows the raw note text)',
		},
	] as const,
)

/** Inferred settings type for the Subreddit Notes module. */
export type SubredditNotesSettings = InferSettings<typeof settings>
