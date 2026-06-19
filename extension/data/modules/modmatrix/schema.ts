/** Data types, state shape, action union, and grouping definitions for the Mod Log Matrix feature. */

import type {RedditModLogEntry,} from '../../api/resources/subreddits'

/** Display metadata for a single mod-log action type. */
export interface ActionInfo {
	/** Human-readable label (e.g. "Remove post"). */
	title: string
	/** CSS class name applied to the icon element. */
	className: string
}

/** A single entry from the Reddit mod log API (`/r/{sub}/about/log`). */
export interface ModLogEntry extends RedditModLogEntry {
	/** Preview text of the targeted item, if available. */
	target_body?: string
	/** Reddit fullname of the targeted item (e.g. `t3_abc`), if available. */
	target_fullname?: string
	id: string
}

/** Sort key: 'name' | '__total__' | '__pct__' | '__grp:GroupLabel__' | an action code string */
export type SortKey = string

/** Current column sort configuration. */
export interface SortState {
	/** The column being sorted, or `null` for the default (unsorted) order. */
	key: SortKey | null
	/** `1` = descending (highest first), `-1` = ascending. */
	direction: 1 | -1
}

/** Complete application state for the Mod Log Matrix feature. */
export interface MatrixState {
	subredditUrl: string | null
	subredditName: string | null
	/** Per-moderator action counts, keyed by action code. */
	subredditModerators: Record<string, Record<string, number>>
	/** All action types seen in the subreddit's mod log, keyed by action code. */
	subredditActions: Record<string, ActionInfo>
	/** Active moderator filter; `null` shows all moderators. */
	modFilter: string[] | null
	/** Active action filter; `null` shows all action types. */
	actionFilter: string[] | null
	currentSorting: SortState
	/** Start of the selected date range as a millisecond Unix timestamp, or `null` if not yet set. */
	minDate: number | null
	/** End of the selected date range as a millisecond Unix timestamp, or `null` if not yet set. */
	maxDate: number | null
	/** The oldest log entry received in the current fetch, used for the status bar. */
	firstEntry: ModLogEntry | null
	/** The most recent log entry received in the current fetch, used for the status bar. */
	lastEntry: ModLogEntry | null
	/** Total number of log entries processed in the current fetch. */
	total: number
	loading: boolean
	error: boolean
	showPercentages: boolean
	/** Moderator rows whose percentage falls below this value are highlighted; 0 disables highlighting. */
	highlightThreshold: number
	hideZeroColumns: boolean
	hideZeroMods: boolean
	/** Per-moderator daily action counts indexed by day offset from `minDate`. */
	modTimeline: Record<string, number[]>
	/** Number of days in the timeline, computed from the date range. */
	timelineDays: number
	showSparklines: boolean
}

export type MatrixAction =
	| {type: 'SET_DATE_RANGE'; minDate: number; maxDate: number}
	| {type: 'START_FETCH'}
	| {type: 'PROCESS_BATCH'; entries: ModLogEntry[]}
	| {type: 'FINISH_FETCH'}
	| {type: 'SET_ERROR'}
	| {type: 'RESET_DATA'}
	| {type: 'SET_MOD_FILTER'; modFilter: string[] | null}
	| {type: 'SET_ACTION_FILTER'; actionFilter: string[] | null}
	| {type: 'SET_SORT'; key: SortKey; direction: 1 | -1}
	| {
		type: 'SET_DISPLAY_OPTIONS'
		showPercentages?: boolean
		highlightThreshold?: number
		hideZeroColumns?: boolean
		hideZeroMods?: boolean
		showSparklines?: boolean
	}

/** A leaf sub-group within a top-level {@link GroupDef}. */
export interface SubGroupDef {
	label: string
	/** Action titles (not codes) that belong to this sub-group. */
	items: string[]
}

/** A top-level action group used to organise columns in the matrix. */
export interface GroupDef {
	label: string
	/** Direct action titles that belong to this group (without sub-groups). */
	items?: string[]
	/** Optional sub-groups for finer categorisation. */
	subs?: SubGroupDef[]
}

export const actionGroups: GroupDef[] = [
	{
		label: 'User & Moderator Management',
		subs: [
			{
				label: 'Moderator administration',
				items: [
					'accept moderator invite',
					'add moderator',
					'invite moderator',
					'remove moderator',
					'reorder moderators',
					'permissions',
					'uninvite moderator',
				],
			},
			{
				label: 'User bans / mutes',
				items: ['ban user', 'unban user', 'mute user', 'unmute user',],
			},
			{
				label: 'Contributors / approved users',
				items: ['add contributor', 'remove contributor', 'invite subscriber',],
			},
			{
				label: 'Notes & moderation metadata',
				items: ['add note', 'delete note',],
			},
			{
				label: 'Flair',
				items: ['edit flair',],
			},
		],
	},
	{
		label: 'Content Moderation',
		subs: [
			{
				label: 'Post moderation',
				items: [
					'approve post',
					'remove post',
					'spam post',
					'lock post',
					'unlock post',
					'sticky post',
					'unsticky post',
					'mark nsfw',
					'mark spoiler',
					'unmark spoiler',
					'mark as original content',
					'set contest mode',
					'unset contest mode',
					'set suggested sort',
					'distinguish',
				],
			},
			{
				label: 'Comment moderation',
				items: ['approve comment', 'remove comment', 'spam comment', 'show comment',],
			},
			{
				label: 'Reports handling',
				items: ['ignore reports', 'unignore reports', 'snooze reports', 'unsnooze reports',],
			},
		],
	},
	{
		label: 'Chat Moderation',
		items: [
			'chat approve message',
			'chat ban user',
			'chat unban user',
			'chat remove message',
			'chat invite host',
			'chat remove host',
		],
	},
	{
		label: 'Rules, Removal Reasons & Enforcement',
		subs: [
			{
				label: 'Rules',
				items: ['create rule', 'edit rule', 'delete rule', 'reorder rules',],
			},
			{
				label: 'Removal reasons',
				items: [
					'add removal reason',
					'create removal reason',
					'update removal reason',
					'edit saved response',
					'delete removal reason',
					'reorder removal reason',
				],
			},
		],
	},
	{
		label: 'Community Configuration & Safety',
		subs: [
			{
				label: 'General settings',
				items: [
					'edit settings',
					'community status',
					'style community',
					'widgets',
					'collections',
					'events',
				],
			},
			{
				label: 'Discovery / classification',
				items: [
					'add community topics',
					'remove community topics',
					'override subreddit classification',
					'delete overridden subreddit classification',
					'submit content rating survey',
				],
			},
			{
				label: 'Welcome / onboarding',
				items: ['community welcome_page',],
			},
		],
	},
	{
		label: 'Crowd Control & Anti-Abuse',
		subs: [
			{
				label: 'Crowd control',
				items: [
					'adjust post crowd control level',
					'enable post crowd control filtering',
					'disable post crowd control filtering',
				],
			},
			{
				label: 'Posting / commenting restrictions',
				items: ['edit post requirements', 'edit comment requirements',],
			},
			{
				label: 'Assistance / escalation',
				items: ['request assistance',],
			},
		],
	},
	{
		label: 'Wiki Management',
		subs: [
			{
				label: 'Wiki permissions',
				items: ['wiki page permissions', 'delist/relist wiki pages',],
			},
			{
				label: 'Wiki contributors',
				items: [
					'add wiki contributor',
					'remove wiki contributor',
					'ban from wiki',
					'unban from wiki',
				],
			},
			{
				label: 'Wiki editing',
				items: ['wiki revise page',],
			},
		],
	},
	{
		label: 'Scheduled & Automated Content',
		items: [
			'create scheduled post',
			'edit scheduled post',
			'delete scheduled post',
			'submit scheduled post',
		],
	},
	{
		label: 'Awards',
		subs: [
			{
				label: 'Award lifecycle',
				items: ['create award', 'delete award', 'enable award', 'disable award',],
			},
			{
				label: 'Award moderation',
				items: ['approve award', 'mod award given', 'award hidden',],
			},
		],
	},
	{
		label: 'Apps & Integrations',
		items: ['app installed', 'app uninstalled', 'app enabled', 'app disabled', 'app changed',],
	},
]

/**
 * Builds a case-insensitive map from action title to action code for a given `subredditActions` map.
 * Shared by {@link sortActionCodes} and {@link buildActionGroupMap} to avoid duplicating iteration.
 */
function buildTitleToCodeMap (
	subredditActions: Record<string, {title: string}>,
): Map<string, string> {
	const map = new Map<string, string>()
	for (const [code, info,] of Object.entries(subredditActions,)) {
		map.set(info.title.toLowerCase(), code,)
	}
	return map
}

/**
 * Returns `actionCodes` sorted so that codes whose titles match entries in {@link actionGroups}
 * appear first in group order, with any unrecognised codes appended at the end.
 */
export function sortActionCodes (
	actionCodes: string[],
	subredditActions: Record<string, {title: string}>,
): string[] {
	const titleToCode = buildTitleToCodeMap(subredditActions,)

	const ordered: string[] = []
	const seen = new Set<string>()

	for (const group of actionGroups) {
		const titles = [
			...(group.items ?? []),
			...(group.subs ?? []).flatMap((s,) => s.items),
		]
		for (const title of titles) {
			const code = titleToCode.get(title.toLowerCase(),)
			if (code !== undefined && !seen.has(code,)) {
				ordered.push(code,)
				seen.add(code,)
			}
		}
	}

	for (const code of actionCodes) {
		if (!seen.has(code,)) {
			ordered.push(code,)
		}
	}

	return ordered
}

/** Maps action code -> top-level group label. Codes not in any group map to 'Other'. */
export function buildActionGroupMap (
	subredditActions: Record<string, {title: string}>,
): Map<string, string> {
	const titleToCode = buildTitleToCodeMap(subredditActions,)

	const result = new Map<string, string>()
	for (const group of actionGroups) {
		const titles = [
			...(group.items ?? []),
			...(group.subs ?? []).flatMap((s,) => s.items),
		]
		for (const title of titles) {
			const code = titleToCode.get(title.toLowerCase(),)
			if (code !== undefined) {
				result.set(code, group.label,)
			}
		}
	}
	return result
}

/** A column group as used by MatrixTable. */
export interface ColumnGroup {
	label: string
	codes: string[]
	isOther: boolean
}

/** Builds an ordered list of column groups from the sorted action codes. */
export function buildColumnGroups (
	sortedActionCodes: string[],
	groupMap: Map<string, string>,
): ColumnGroup[] {
	const groupOrder: string[] = []
	const groupCodes: Map<string, string[]> = new Map()

	for (const code of sortedActionCodes) {
		const label = groupMap.get(code,) ?? 'Other'
		if (!groupCodes.has(label,)) {
			groupCodes.set(label, [],)
			groupOrder.push(label,)
		}
		groupCodes.get(label,)!.push(code,)
	}

	return groupOrder.map((label,) => ({
		label,
		codes: groupCodes.get(label,)!,
		isOther: label === 'Other',
	}))
}
