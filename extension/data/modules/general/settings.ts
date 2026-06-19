/** Settings definitions for the General Settings module, covering notifications and the context menu. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'nativeNotifications',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Display native operating system notifications rather than in-page notifications',
		},
		{
			id: 'contextMenuLocation',
			sharedPolicy: 'raw',
			type: 'selector',
			default: 'left',
			values: ['left', 'right',] as const,
			advanced: false,
			description: 'Side of the screen the context menu is shown',
		},
		{
			id: 'contextMenuAttention',
			sharedPolicy: 'raw',
			type: 'selector',
			default: 'open',
			values: ['open', 'fade', 'none',] as const,
			advanced: false,
			description: 'Select what effect the context menu uses to show that new items are available',
		},
		{
			id: 'contextMenuClick',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			advanced: false,
			description: 'Make the context menu only open when you click on it',
		},
	] as const,
)

/** Inferred type of the General Settings object. */
export type GenSettings = InferSettings<typeof settings>
