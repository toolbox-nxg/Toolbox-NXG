/** Settings definitions for the Domain Tagger module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'displayType',
			sharedPolicy: 'raw',
			description: 'Tag location',
			type: 'selector',
			values: ['title_dot', 'post_border', 'post_title', 'domain_background', 'domain_border',] as const,
			default: 'title_dot',
		},
	] as const,
)

/** Inferred type of the Domain Tagger settings object. */
export type DomainTaggerSettings = InferSettings<typeof settings>
