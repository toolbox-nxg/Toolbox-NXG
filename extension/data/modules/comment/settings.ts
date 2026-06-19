/** Setting definitions and inferred settings type for the Comments module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'openContextInPopup',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Add a link to comments where appropiate to open the context in a popup on page.',
		},
		{
			id: 'highlighted',
			sharedPolicy: 'length',
			type: 'stringlist',
			default: [] as string[],
			description: 'Highlight keywords. Enter one keyword per line.',
		},
		// Settings for old reddit only
		{
			id: 'hideRemoved',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			advanced: true,
			description: 'Hide removed comments by default.',
			oldReddit: true,
		},
		{
			id: 'approveComments',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Show approve button on all comments.',
			oldReddit: true,
		},
		{
			id: 'spamRemoved',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Show spam button on comments removed as ham.',
			oldReddit: true,
		},
		{
			id: 'hamSpammed',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Show remove (not spam) button on comments removed as spam.',
			oldReddit: true,
		},
		{
			id: 'showHideOld',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			advanced: false,
			description: 'Show button to hide old comments.',
			oldReddit: true,
		},
	] as const,
)

/** Inferred settings type for the Comments module. */
export type CommentsSettings = InferSettings<typeof settings>
