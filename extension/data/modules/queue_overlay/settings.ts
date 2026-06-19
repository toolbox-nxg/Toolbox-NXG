/** Settings definitions for the Queue Overlay module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'overlayFromBarRedesign',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description:
				'In redesign when clicking queue and unmoderated icons open the old reddit variants in an overlay.',
		},
		{
			id: 'overlayFromBarOld',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			oldReddit: true,
			description: 'Open queue and unmoderated in overlay when clicking on them from the modbar.',
		},
	] as const,
)

/** Inferred settings type for the Queue Overlay module. */
export type QueueOverlaySettings = InferSettings<typeof settings>
