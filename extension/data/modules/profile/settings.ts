/** Settings definitions for the Profile Pro module. */
import {defineSettings, InferSettings,} from '../../framework/module'
import {getSettingAsync,} from '../../util/persistence/settings'

export const settings = defineSettings(
	[
		{
			id: 'alwaysTbProfile',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Always open toolbox profile overlay on reddit profiles.',
		},
		{
			id: 'profileButtonEnabled',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description:
				'Show profile button next to usernames. Allows you to quickly open the toolbox profile for that user.',
		},
		{
			id: 'directProfileToLegacy',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Open legacy user overview when clicking on profile links.',
		},
		{
			id: 'subredditColor',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: () => getSettingAsync('QueueTools', 'subredditColor', false,),
			hidden: true,
		},
	] as const,
)

/** Inferred settings type for the Profile Pro module. */
export type ProfileSettings = InferSettings<typeof settings>
