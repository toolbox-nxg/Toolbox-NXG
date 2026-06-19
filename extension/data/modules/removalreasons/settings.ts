/** Module settings definitions for the Removal Reasons module. */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'commentReasons',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			description: 'Enable removal reasons for comments.',
		},
		{
			id: 'alwaysShow',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			description: 'Show an empty removal reason box for subreddits that don\'t have removal reasons.',
		},
		{
			id: 'displayMode',
			sharedPolicy: 'raw',
			type: 'selector' as const,
			values: ['Drawer', 'Popup (legacy)',] as const,
			default: 'Drawer',
			description: 'How removal reasons should be displayed.',
		},
		{
			id: 'silentRemoveDeletedUsers',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			description: 'Silently remove content from deleted users without opening removal reasons.',
		},
		{
			id: 'reasonType',
			sharedPolicy: 'raw',
			type: 'selector' as const,
			values: [
				'Reply with a comment to the item that is removed',
				'Send as PM (personal message)',
				'Send as both PM and reply',
				'None (This only works when a logsub has been set)',
			] as const,
			default: 'Reply with a comment to the item that is removed',
			description: 'Method of sending removal reasons.',
			// The stored values above are slugified from these labels and shared with
			// Toolbox 6.x; keep them unchanged and only override the displayed text here.
			valueLabels: {
				'Send as PM (personal message)': 'Send as Modmail',
				'Send as both PM and reply': 'Send as both Modmail and reply',
			},
			valueNotes: {
				'None (This only works when a logsub has been set)':
					'Requires a log subreddit (logsub) to be configured per-subreddit in the subreddit config overlay. Without a logsub set, removal reasons will not be logged.',
			},
		},
		{
			id: 'reasonAsSub',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: true,
			advanced: false,
			description: 'Hide your username when sending Modmail.',
		},
		{
			id: 'reasonAutoArchive',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			advanced: false,
			description: 'Auto-archive sent Modmail.',
		},
		{
			id: 'reasonSticky',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			description: 'Leave removal reasons as a sticky comment.',
		},
		{
			id: 'reasonCommentAsSubreddit',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			description: 'Leave removal reason comments with /u/subreddit-ModTeam.',
		},
		{
			id: 'actionLock',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			description: 'Lock threads after leaving a removal reason.',
		},
		{
			id: 'actionLockComment',
			sharedPolicy: 'raw',
			type: 'boolean' as const,
			default: false,
			description: 'Lock removal reasons when replying as a comment.',
		},
		{
			id: 'disableRemoveButton',
			type: 'boolean' as const,
			default: false,
			description: 'Disable the remove button after removing an item.',
		},
		{
			id: 'customRemovalReason',
			type: 'text' as const,
			default:
				'%3Ctextarea%20id%3D%22customTextarea%22%20%20class%3D%22tb-input%22%20placeholder%3D%22Enter%20Custom%20reason%22%3E%3C/textarea%3E',
			hidden: true,
		},
	] as const,
)

/** Inferred settings type for the Removal Reasons module. */
export type RemovalReasonsSettings = InferSettings<typeof settings>
