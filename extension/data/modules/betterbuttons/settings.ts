/** Setting definitions and inferred settings type for the Better Buttons module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'enableModSave',
			sharedPolicy: 'raw',
			description: 'Add distinguish and distinguish + sticky toggles to the comment reply box.',
			type: 'boolean',
			default: false,
		},
		{
			id: 'enableDistinguishToggle',
			sharedPolicy: 'raw',
			description: 'Add a sticky shortcut to your comments and skip the distinguish confirmation step.',
			type: 'boolean',
			default: false,
		},
		{
			id: 'removeRemoveConfirmation',
			sharedPolicy: 'raw',
			description: 'Remove remove/approve confirmation when removing items.',
			type: 'boolean',
			default: false,
			advanced: true,
		},
		{
			id: 'approveOnIgnore',
			sharedPolicy: 'raw',
			description: 'Auto-approve items when ignoring reports.',
			type: 'boolean',
			default: false,
		},
		{
			id: 'ignoreOnApprove',
			sharedPolicy: 'raw',
			description: 'Auto-ignore reports when approving items.',
			type: 'boolean',
			default: false,
		},
		{
			id: 'spamRemoved',
			sharedPolicy: 'raw',
			description: 'Show spam button on submissions removed as ham.',
			type: 'boolean',
			default: false,
		},
		{
			id: 'hamSpammed',
			sharedPolicy: 'raw',
			description: 'Show remove (not spam) button on submissions removed as spam.',
			type: 'boolean',
			default: false,
		},
		{
			id: 'addStickyButton',
			sharedPolicy: 'raw',
			description: 'Add sticky/unsticky buttons to post listings.',
			type: 'boolean',
			default: false,
			advanced: false,
		},
		{
			id: 'addCommentLockbutton',
			sharedPolicy: 'raw',
			description: 'Add comment lock button to comments.',
			type: 'boolean',
			default: true,
			advanced: false,
		},
	] as const,
)

/** Inferred settings type for the Better Buttons module. */
export type BetterButtonsSettings = InferSettings<typeof settings>
