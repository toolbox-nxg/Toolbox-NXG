/** Settings definitions for the Custom CSS module: the moderator's own stylesheet. */
import {defineSettings, type InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			// No sharedPolicy: free-form CSS stays out of anonymized settings shared for support.
			id: 'css',
			type: 'code',
			default: '',
			description:
				'CSS applied to Reddit and to every Toolbox window. Unsupported: Toolbox updates may change what your rules match',
		},
	] as const,
)

/** Inferred type of the Custom CSS settings object. */
export type CustomCssSettings = InferSettings<typeof settings>
