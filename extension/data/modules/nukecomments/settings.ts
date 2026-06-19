/** Settings definitions and inferred type for the Comment Nuke module. */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'ignoreDistinguished',
			sharedPolicy: 'raw',
			description: 'Ignore distinguished comments from mods and admins when nuking a chain.',
			type: 'boolean',
			default: true,
		},
		{
			id: 'executionType',
			sharedPolicy: 'raw',
			description: 'Default nuke type selected when nuking',
			type: 'selector',
			values: ['remove', 'lock',] as const,
			default: 'remove',
			advanced: true,
		},
		// Settings for old reddit only
		{
			id: 'showNextToUser',
			sharedPolicy: 'raw',
			description: 'Show nuke button next to the username instead of under the comment.',
			type: 'boolean',
			default: true,
			advanced: true,
		},
	] as const,
)

/** Inferred settings type for the Comment Nuke module. */
export type NukeCommentsSettings = InferSettings<typeof settings>
