/** Module settings definitions for the Shreddit (new Reddit UI) module. */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'feedPageUsernames',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: true,
			description:
				'Show author names on feed pages (front page, r/popular, r/all, etc.) where Reddit does not display them',
		},
		{
			id: 'pinnedPostUsernames',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: true,
			description: 'Show author names on pinned posts (card mode)',
		},
	] as const,
)

/** Inferred settings type for the Shreddit module. */
export type ShredditSettings = InferSettings<typeof settings>
