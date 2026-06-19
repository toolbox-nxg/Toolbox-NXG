/** Settings definitions for the Queue Tools module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'showActionReason',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description:
				'Show previously taken actions next to submissions. Based on the last 500 actions in the subreddit modlog',
		},
		{
			id: 'expandActionReasonQueue',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Automatically expand the mod action table in queues',
		},
		{
			id: 'showReportReasons',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Add button to show reports on posts with ignored reports.',
		},
		{
			id: 'queueCreature',
			sharedPolicy: 'populated',
			type: 'selector',
			values: ['kitteh', 'puppy', '/r/spiderbros', 'piggy', 'i have no soul',] as const,
			default: 'kitteh',
			description: 'Queue Creature',
		},
	] as const,
)

/** Inferred settings type for the Queue Tools module. */
export type QueueToolsSettings = InferSettings<typeof settings>
