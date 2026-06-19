/** User-facing settings definitions for the Modbar module. */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'compactHide',
			sharedPolicy: 'raw',
			description: 'Use compact mode for modbar',
			type: 'boolean' as const,
			default: false,
			advanced: true,
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
			default: {} as Record<string, string>,
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
			id: 'customCSS',
			type: 'code' as const,
			default: '',
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
