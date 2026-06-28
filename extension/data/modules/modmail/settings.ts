/** Settings definitions and inferred type for the Modmail module. */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'previewByDefault',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Automatically enable markdown preview in the modmail reply composer',
		},
		{
			id: 'searchAtTop',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Always show the modmail search bar and hide the search toggle button',
		},
		{
			id: 'showRecentMessageTime',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Show the time next to modmail message dates for messages less than 24 hours old',
		},
		{
			id: 'hideUserSidebarProfileIcon',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Hide the banner and profile picture in the modmail user sidebar, widening the username area',
		},
		{
			id: 'usernameProfileWhenSidebarOpen',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description:
				'In a modmail thread, clicking a participant username opens their profile page when the user info sidebar is already open',
		},
	] as const,
)

/** Inferred settings type for the Modmail module. */
export type ModmailSettings = InferSettings<typeof settings>
