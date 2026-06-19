/** Settings definitions for the Developer Tools module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'apiHelper',
			sharedPolicy: 'raw',
			description: 'Show api button next for each element received from front-end api',
			type: 'boolean',
			default: false,
			advanced: true,
		},
		{
			id: 'commentUItester',
			sharedPolicy: 'raw',
			description: 'Add a button to the context menu that opens an overlay to test a variety of UI things.',
			type: 'boolean',
			default: false,
			advanced: true,
		},
	] as const,
)

/** Inferred type of the Developer Tools settings object. */
export type DevToolsSettings = InferSettings<typeof settings>
