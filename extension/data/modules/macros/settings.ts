/** User-facing settings definitions for the Mod Macros module. */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'showMacroPreview',
			sharedPolicy: 'raw',
			description: 'Show a preview of macro messages while typing.',
			type: 'boolean',
			default: true,
		},
	] as const,
)

/** Inferred settings type for the Mod Macros module. */
export type MacrosSettings = InferSettings<typeof settings>
