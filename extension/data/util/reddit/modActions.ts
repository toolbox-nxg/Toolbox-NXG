/** Shared utilities for classifying and labelling Reddit mod-log action types. */

/** Broad category of a mod action, used to apply row coloring. */
export type ActionFamily = 'approval' | 'remove' | 'ban' | 'other'

/**
 * Maps raw Reddit mod-log action strings to human-readable labels.
 * Falls back to the raw action string for unlisted actions.
 */
export const actionLabels: Record<string, string> = {
	approvelink: 'Approved post',
	removelink: 'Removed post',
	approvecomment: 'Approved comment',
	removecomment: 'Removed comment',
	banuser: 'Banned user',
	unbanuser: 'Unbanned user',
	muteuser: 'Muted user',
	unmuteuser: 'Unmuted user',
	addmoderator: 'Added mod',
	removemoderator: 'Removed mod',
	addcontributor: 'Added contributor',
	removecontributor: 'Removed contributor',
	editflair: 'Edited flair',
	distinguish: 'Distinguished',
	lock: 'Locked',
	unlock: 'Unlocked',
	spamlink: 'Spammed post',
	spamcomment: 'Spammed comment',
	sticky: 'Stickied',
	unsticky: 'Unstickied',
}

/**
 * Maps raw Reddit mod-log action strings to their broad {@link ActionFamily} category.
 * Actions not listed here fall into the `'other'` family.
 */
export const actionFamily: Record<string, ActionFamily> = {
	approvelink: 'approval',
	approvecomment: 'approval',
	removelink: 'remove',
	removecomment: 'remove',
	spamlink: 'remove',
	spamcomment: 'remove',
	banuser: 'ban',
	unbanuser: 'ban',
	muteuser: 'ban',
	unmuteuser: 'ban',
}
