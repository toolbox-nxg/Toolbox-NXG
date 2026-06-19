/** User-facing settings definitions for the Mod Button module. */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'savedSubs',
			sharedPolicy: 'length',
			type: 'sublist' as const,
			default: [] as string[],
			description: 'Saved subs (for quick access)',
		},
		{
			id: 'rememberLastAction',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			description: 'Remember last action',
		},
		{
			id: 'globalButton',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			advanced: true,
			description: 'Enable Global Action button',
		},
		{
			id: 'excludeGlobal',
			sharedPolicy: 'raw',
			type: 'sublist' as const,
			default: [] as string[],
			advanced: true,
			description: 'Exclude subs from Global Actions',
		},
		// private storage
		{
			id: 'lastAction',
			sharedPolicy: 'populated',
			type: 'text' as const,
			default: 'ban',
			hidden: true,
		},
	] as const,
)

/** Inferred settings type for the Mod Button module. */
export type ModButtonSettings = InferSettings<typeof settings>
