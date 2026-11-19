/** Module settings definitions for the Native Mod Log module. */

import {defineSettings, type InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'defaultTabName',
			sharedPolicy: 'raw',
			description: 'Default tab for the native mod log popup',
			type: 'selector',
			values: ['All Activity', 'Notes', 'Mod Actions',] as const,
			default: 'all_activity',
		},
		{
			id: 'defaultNoteLabel',
			sharedPolicy: 'raw',
			description: 'Default label for new native notes',
			type: 'selector',
			values: [
				'None',
				'Bot Ban',
				'Permaban',
				'Ban',
				'Abuse Warning',
				'Spam Warning',
				'Spam Watch',
				'Solid Contributor',
				'Helpful User',
			] as const,
			default: 'none',
		},
		{
			id: 'notesTabLayout',
			sharedPolicy: 'raw',
			description: 'Layout of the Notes tab in the native mod log popup (Table matches the other tabs)',
			type: 'selector',
			values: ['Cards', 'Table',] as const,
			default: 'cards',
		},
		{
			id: 'banWithBanLabel',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description:
				'Turn on the ban option when choosing the Ban or Permaban label for a new native note (off: tick it to ban)',
		},
		{
			id: 'banNoteDuration',
			sharedPolicy: 'raw',
			type: 'text',
			default: '',
			advanced: true,
			description:
				'Read the ban duration from the note: a regular expression whose first capture group is the days (Ban label only)',
		},
		{
			id: 'showAiSummaries',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Show Reddit\'s AI-generated user summaries on the NN tag and in the mod log',
		},
		{
			id: 'showModActions',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description:
				'Show mod actions (removals, bans, approvals, ...) alongside notes on the NN tag and in the mod log',
		},
		{
			id: 'maxChars',
			sharedPolicy: 'raw',
			type: 'number',
			default: 20,
			advanced: true,
			description: 'Max characters of the latest note to display in the NN tag',
		},
	] as const,
)

/** Inferred settings type for the Native Mod Log module. */
export type NativeModLogSettings = InferSettings<typeof settings>
