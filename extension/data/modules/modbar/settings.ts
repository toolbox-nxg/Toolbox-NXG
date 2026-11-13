/** User-facing settings definitions for the Modbar module. */

import {defineSettings, type InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'compactHide',
			sharedPolicy: 'raw',
			description: 'Use compact mode for modbar (a small dot when collapsed, without the hover counts)',
			type: 'boolean' as const,
			default: false,
			advanced: true,
		},
		{
			// Read by the Announcements module too: with the label off, a prerelease build shows a
			// reminder popup once per tab instead, so testers can't forget they're on a beta.
			id: 'showPrereleaseLabel',
			sharedPolicy: 'raw',
			description:
				'Show the version label on beta builds (when off, a reminder popup appears in each new tab instead)',
			type: 'boolean' as const,
			default: true,
			advanced: true,
		},
		{
			id: 'showCounters',
			sharedPolicy: 'raw',
			description: 'Show counts next to the modbar queue and modmail icons',
			type: 'boolean' as const,
			default: true,
		},
		{
			id: 'unmoderatedOn',
			sharedPolicy: 'raw',
			description: 'Show icon for unmoderated',
			type: 'boolean' as const,
			default: false,
		},
		{
			id: 'enableModSubs',
			sharedPolicy: 'raw',
			description: 'Show Moderated Subreddits in the modbar',
			type: 'boolean' as const,
			default: true,
		},
		{
			id: 'enableRecentActions',
			sharedPolicy: 'raw',
			description: 'Show Recent Actions in the modbar',
			type: 'boolean' as const,
			default: true,
		},
		{
			id: 'enableOldNewToggle',
			sharedPolicy: 'raw',
			description: 'Include a button in the modbar to swap between old and new Reddit',
			type: 'boolean' as const,
			default: true,
		},
		{
			id: 'shortcuts',
			sharedPolicy: 'length',
			description: 'Shortcuts',
			type: 'map' as const,
			default: {},
			labels: ['name', 'url',],
			hidden: false,
		},
		{
			id: 'modbarHidden',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			hidden: true,
		},
		{
			id: 'lockScroll',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			hidden: true,
		},
		{
			id: 'lastExport',
			sharedPolicy: 'populated',
			type: 'number' as const,
			default: 0,
			hidden: true,
		},
		{
			id: 'showExportReminder',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: true,
			hidden: true,
		},
		{
			id: 'subredditColorSalt',
			type: 'text' as const,
			default: 'PJSalt',
			hidden: true,
		},
	] as const,
)

/** Inferred settings type for the Modbar module. */
export type ModbarSettings = InferSettings<typeof settings>
