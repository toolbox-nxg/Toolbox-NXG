/** Settings tab for configuring training mode: which moderators are trainees and how long proposals are kept. */

import {useEffect, useState,} from 'react'

import {getCurrentUser,} from '../../../api/resources/me'
import {getSubredditListing,} from '../../../api/resources/subreddits'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {NumberInput,} from '../../../shared/controls/NumberInput'
import {positiveTextFeedback,} from '../../../store/feedback'
import createLogger from '../../../util/infra/logging'
import {type SaveRef, useSaveRef,} from '../../../util/ui/hooks'
import type {ConfigState, ToolboxConfig,} from '../../../util/wiki/schemas/config/schema'
import type {ProposedActionType,} from '../../../util/wiki/schemas/proposals/schema'
import {compatMirrorEnabled, resolveWikiLayout,} from '../../../util/wiki/wikiPaths'
import css from './TrainingSettingsTab.module.css'

const log = createLogger('TBProposals',)

/** Minimum and maximum retention window (days) accepted by the input. */
const MIN_RETENTION = 1
const MAX_RETENTION = 365

/**
 * The guardable action types, grouped into friendly rows for the settings UI. Each row's
 * checkbox toggles its whole `types` set in/out of the subreddit's `guardedActions` list.
 * Every {@link ProposedActionType} must appear in exactly one group.
 */
const ACTION_GROUPS: ReadonlyArray<{label: string; types: readonly ProposedActionType[]}> = [
	{label: 'Approvals', types: ['approve',],},
	{label: 'Removals (with or without a reason)', types: ['remove', 'removal-reason',],},
	{label: 'Lock / unlock', types: ['lock', 'unlock',],},
	{label: 'Bans & mutes', types: ['ban', 'unban', 'mute', 'unmute',],},
	{label: 'Post attributes (distinguish, mark NSFW, sticky)', types: ['distinguish', 'marknsfw', 'sticky',],},
	{label: 'User flair', types: ['userflair',],},
]

/** Every guardable action type, flattened from {@link ACTION_GROUPS}. */
const ALL_ACTION_TYPES: readonly ProposedActionType[] = ACTION_GROUPS.flatMap((g,) => g.types)

/** Props for the TrainingSettingsTab component. */
interface Props {
	/** Config state object for the current subreddit. */
	state: ConfigState
	/** Optional ref wired up so the parent can trigger saving the settings. */
	saveRef?: SaveRef
	/** Called with the updated config and revision note when the user saves. */
	onSave: (config: ToolboxConfig, reason: string,) => void
}

/** One moderator entry from the subreddit's about/moderators listing. */
interface ModeratorEntry {
	name: string
	mod_permissions: string[]
}

/**
 * Renders the training-mode settings panel: a checkbox per subreddit moderator
 * (on = their in-scope actions are captured for review) plus the resolved-proposal
 * retention window.
 */
export function TrainingSettingsTab ({state, saveRef, onSave,}: Props,) {
	const config = state.config ?? {}
	const subreddit = state.subreddit

	const [mods, setMods,] = useState<ModeratorEntry[] | null>(null,)
	const [error, setError,] = useState<string | null>(null,)
	const [compatOn, setCompatOn,] = useState(false,)
	// Current user's lowercased name, for the seniority guard; '' until resolved.
	const [currentUserLower, setCurrentUserLower,] = useState('',)
	// Selected trainees as a set of lowercased usernames (case-insensitive).
	const [selected, setSelected,] = useState<Set<string>>(
		() => new Set((config.trainingMods ?? []).map((m: string,) => m.toLowerCase()),),
	)
	// Guarded action types. Absent in config ⇒ every action is guarded, so start with all
	// types selected (the original all-or-nothing default); an explicit list narrows it.
	const [guarded, setGuarded,] = useState<Set<ProposedActionType>>(
		() =>
			config.guardedActions
				? new Set(config.guardedActions as ProposedActionType[],)
				: new Set(ALL_ACTION_TYPES,),
	)
	const [retention, setRetention,] = useState<number>(
		typeof config.proposalRetentionDays === 'number' ? config.proposalRetentionDays : 14,
	)

	// Load the moderator list and 6.x-compat status for the current subreddit.
	useEffect(() => {
		if (!subreddit) { return }
		let cancelled = false
		void (async () => {
			try {
				const listing = await getSubredditListing<ModeratorEntry>(subreddit, 'moderators', {limit: '100',},)
				if (!cancelled) { setMods(listing?.data?.children ?? [],) }
			} catch (err) {
				log.warn(`could not load moderators for /r/${subreddit}`, err,)
				if (!cancelled) { setError('Could not load the moderator list.',) }
			}
			try {
				const layout = await resolveWikiLayout(subreddit,)
				if (!cancelled) { setCompatOn(compatMirrorEnabled(layout,),) }
			} catch {
				// Non-fatal: just skip the compat warning if layout can't be resolved.
			}
			try {
				const me = await getCurrentUser()
				if (!cancelled) { setCurrentUserLower(me.toLowerCase(),) }
			} catch {
				// Non-fatal: the seniority guard simply fails open when we can't resolve self.
			}
		})()
		return () => {
			cancelled = true
		}
	}, [subreddit,],)

	// The current user's position in the (seniority-ordered) moderator list, or -1 when
	// not found / not yet loaded. Mods at index <= this - themselves and anyone more senior -
	// are locked: a moderator can only change training settings for mods below them. When
	// the current user isn't in the fetched list we fail open (no locking).
	const currentUserIndex = currentUserLower && mods
		? mods.findIndex((m,) => m.name.toLowerCase() === currentUserLower)
		: -1

	/** Whether the moderator at `index` is locked (self or more senior) from being changed. */
	function isModLocked (index: number,): boolean {
		return currentUserIndex !== -1 && index <= currentUserIndex
	}

	/** Toggles a moderator's trainee membership. */
	function toggleTrainee (name: string, checked: boolean,) {
		setSelected((prev,) => {
			const next = new Set(prev,)
			if (checked) {
				next.add(name.toLowerCase(),)
			} else {
				next.delete(name.toLowerCase(),)
			}
			return next
		},)
	}

	/** Adds or removes a whole action group's types from the guarded set. */
	function toggleActionGroup (types: readonly ProposedActionType[], checked: boolean,) {
		setGuarded((prev,) => {
			const next = new Set(prev,)
			for (const type of types) {
				if (checked) { next.add(type,) }
				else { next.delete(type,) }
			}
			return next
		},)
	}

	function handleSave () {
		if (!subreddit) { return }
		const listed = mods ?? []
		const listedLower = new Set(listed.map((m,) => m.name.toLowerCase()),)
		// Trainees chosen from the moderator list, stored in their canonical case.
		const selectedFromList = listed.filter((m,) => selected.has(m.name.toLowerCase(),)).map((m,) => m.name)
		// Preserve any configured trainee who isn't in the fetched list (e.g. a large
		// mod team beyond the page, or a transient fetch gap) so a save can't silently
		// drop them.
		const keptUnlisted = (config.trainingMods ?? []).filter((m: string,) => !listedLower.has(m.toLowerCase(),))

		const clampedRetention = Math.min(
			MAX_RETENTION,
			Math.max(MIN_RETENTION, Math.floor(Number.isFinite(retention,) ? retention : 14,),),
		)

		state.config.trainingMods = [...selectedFromList, ...keptUnlisted,]
		// Persist the guarded-action set in canonical order. When every action is guarded,
		// drop the field so the config stays in its "absent ⇒ all guarded" default rather than
		// pinning an explicit full list (behaviorally identical, but tidier and forward-compatible
		// if new action types are added later).
		if (guarded.size >= ALL_ACTION_TYPES.length) {
			delete state.config.guardedActions
		} else {
			state.config.guardedActions = ALL_ACTION_TYPES.filter((t,) => guarded.has(t,))
		}
		state.config.proposalRetentionDays = clampedRetention
		onSave(state.config, 'updated training mode settings',)
		positiveTextFeedback('Training mode settings are saved',)
	}
	useSaveRef(saveRef, handleSave,)

	return (
		<div id="toolbox-training-settings">
			{compatOn && (
				<div className={css.compatWarning}>
					This subreddit still writes Toolbox 6.x compatibility pages, so some moderators may be using classic
					Toolbox. Training-mode proposals are NXG-only - those moderators will not see or review them, and
					may action items directly. Enable training mode only if your whole team is on Toolbox-NXG.
				</div>
			)}

			<div className={css.section}>
				<div className={css.sectionTitle}>Moderators in training</div>
				<p className={css.sectionDesc}>
					When a moderator is in training, their approve/remove/ban/lock actions are captured as proposals for
					another moderator to review instead of taking effect immediately.
				</p>
				{mods === null && !error && <div className={css.status}>Loading moderators...</div>}
				{error && <div className={css.status}>{error}</div>}
				{mods !== null && mods.length === 0 && !error && (
					<div className={css.status}>No moderators found.</div>
				)}
				{mods !== null && mods.length > 0 && (
					<div className={css.modList}>
						{mods.map((mod, index,) => {
							const locked = isModLocked(index,)
							return (
								<CheckboxInput
									key={mod.name}
									label={
										<>
											u/{mod.name}
											{locked && <span className={css.hint}>- more senior, cannot change</span>}
										</>
									}
									checked={selected.has(mod.name.toLowerCase(),)}
									disabled={locked}
									onChange={(e,) => toggleTrainee(mod.name, e.target.checked,)}
								/>
							)
						},)}
					</div>
				)}
			</div>

			{selected.size > 0 && (
				<div className={css.section}>
					<div className={css.sectionTitle}>Actions to guard</div>
					<p className={css.sectionDesc}>
						Which kinds of action are captured for review. Trainees can take any unchecked action directly,
						without review. (Anything left checked is captured.) Applies to every moderator in training
						above.
					</p>
					<div className={css.modList}>
						{ACTION_GROUPS.map((group,) => (
							<CheckboxInput
								key={group.label}
								label={group.label}
								checked={group.types.every((t,) => guarded.has(t,))}
								onChange={(e,) => toggleActionGroup(group.types, e.target.checked,)}
							/>
						))}
					</div>
				</div>
			)}

			<div className={css.section}>
				<div className={css.sectionTitle}>Proposal retention</div>
				<p className={css.sectionDesc}>
					How many days to keep a resolved proposal (accepted, rejected, or obsolete) before it is pruned,
					unless the proposer dismisses it sooner.
				</p>
				<NumberInput
					label="Days to keep resolved proposals"
					min={MIN_RETENTION}
					max={MAX_RETENTION}
					value={retention}
					onChange={(e,) => setRetention(e.target.valueAsNumber,)}
				/>
			</div>
		</div>
	)
}
