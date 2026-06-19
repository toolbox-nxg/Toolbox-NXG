/** Settings definitions for the Mod View Enhancements module. */
import {defineSettings, InferSettings,} from '../../framework/module'
import {iconBot,} from './botIcon'

export const settings = defineSettings(
	[
		{
			id: 'subredditColor',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Add a border to items in the queue with color unique to the subreddit name.',
		},
		{
			id: 'subredditColorSalt',
			sharedPolicy: 'populated',
			type: 'text',
			default: 'PJSalt',
			description:
				'Text to randomly change the subreddit color (only applies when subreddit color borders are enabled)',
			advanced: true,
		},
		{
			id: 'subredditColorOverrides',
			type: 'map',
			default: {} as Record<string, string>,
			labels: ['subreddit', 'color (#rrggbb)',],
			description:
				'Override the auto-generated border color for specific subreddits. Enter the subreddit name and a hex color (e.g. #ff0000). Only applies when subreddit color borders are enabled.',
		},
		{
			id: 'highlightNegativePosts',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Highlight posts with a score of 0.',
		},
		{
			id: 'showAutomodActionReason',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Show the action reason from automoderator below submissions and comments.',
			oldReddit: true,
		},
		{
			id: 'botCheckmark',
			sharedPolicy: 'length',
			type: 'stringlist',
			default: ['AutoModerator',],
			description: 'Make bot approved checkmarks have a different look',
			placeholder: 'Bot username',
			previewImageUrl: iconBot,
			oldReddit: true,
		},
		{
			id: 'highlightAutomodMatches',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description:
				'Highlight words in bot mods report and action reasons which are enclosed in []. Can be used to highlight bot mods regex matches.',
		},
		{
			id: 'highlightAutomodMatchesSubreddit',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description:
				'Also highlight bracketed bot/automod report matches outside the mod queue (e.g. subreddit listings and comment pages, when viewed as a mod). Old Reddit only.',
			oldReddit: true,
		},
	] as const,
)

/** Inferred settings type for the Mod View Enhancements module. */
export type ModViewEnhancementsSettings = InferSettings<typeof settings>
