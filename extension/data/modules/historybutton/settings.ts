/** Settings definitions for the History Button module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'alwaysComments',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			advanced: true,
			description: 'Load comment history immediately',
		},
		{
			id: 'commentCount',
			sharedPolicy: 'raw',
			type: 'selector',
			values: ['100', '200', '300', '400', '500', '600', '700', '800', '900', '1000',] as const,
			default: '1000',
			advanced: true,
			description: 'Number of comments to retrieve per user history',
		},
		{
			id: 'includeNsfwSearches',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Include NSFW submissions in searches',
		},
	] as const,
)

/** Inferred type of the History Button settings object. */
export type HistoryButtonSettings = InferSettings<typeof settings>
