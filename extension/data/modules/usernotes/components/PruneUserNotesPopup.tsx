/** Panel for configuring and previewing usernote pruning operations before confirmation. */

import {useMemo, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {NumberInput,} from '../../../shared/controls/NumberInput'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {daysToMilliseconds,} from '../../../util/data/time'
import {
	ArchivedMode,
	PruneOptions,
	PruneProgress,
	UserNoteColor,
	UsernotesUser,
} from '../../../util/wiki/schemas/usernotes/schema'
import {createPrunePreview, normalizeKindKey, type NoteStats, statLabel,} from './UserNotesManagerOverlay.helpers'

import css from './PruneUserNotesPopup.module.css'

/** Props for the PruneUserNotesPanel component. */
interface PruneUserNotesPanelProps {
	/** All users in the current subreddit's usernotes. */
	users: UsernotesUser[]
	colors: UserNoteColor[]
	/** Aggregate note stats for all users, computed once by the overlay. */
	noteStats: NoteStats
	/**
	 * Called when the moderator confirms the prune operation.
	 * @param options The selected pruning criteria.
	 * @param onProgress Callback to report progress updates during the operation.
	 */
	onConfirm: (options: PruneOptions, onProgress: (progress: PruneProgress,) => void,) => Promise<void>
}

function usersToRecord (users: UsernotesUser[],) {
	return Object.fromEntries(users.map((user,) => [user.name, user,]),)
}

/** Renders pruning controls (by age, kind, account status) with a live preview of matching notes. */
export function PruneUserNotesPanel ({
	users,
	colors,
	noteStats,
	onConfirm,
}: PruneUserNotesPanelProps,) {
	const [byAge, setByAge,] = useState(true,)
	const [ageDays, setAgeDays,] = useState(365,)
	const [deselectedKinds, setDeselectedKinds,] = useState<string[]>([],)
	const [byDeleted, setByDeleted,] = useState(false,)
	const [bySuspended, setBySuspended,] = useState(false,)
	const [byInactive, setByInactive,] = useState(false,)
	const [inactiveDays, setInactiveDays,] = useState(180,)
	const [pruneArchived, setPruneArchived,] = useState<ArchivedMode>('include',)
	const [pruneAction, setPruneAction,] = useState<'delete' | 'purge' | 'archive'>('delete',)
	const [progress, setProgress,] = useState<PruneProgress | null>(null,)
	const [isPruning, setIsPruning,] = useState(false,)

	// Can't archive already-archived notes; force delete when targeting archived-only.
	// Purge is a delete variant and passes through as-is.
	const effectivePruneAction = pruneArchived === 'only' && pruneAction === 'archive' ? 'delete' : pruneAction

	const options: PruneOptions = useMemo(() => ({
		pruneByNoteAge: byAge,
		pruneByNoteAgeLimit: daysToMilliseconds(Math.max(1, ageDays,),),
		pruneByNoteAgeDays: Math.max(1, ageDays,),
		pruneNoteTypeMode: deselectedKinds.length === 0 ? 'all' : 'exclude',
		pruneNoteTypes: deselectedKinds,
		pruneArchived,
		pruneAction: effectivePruneAction,
		pruneByUserDeleted: byDeleted,
		pruneByUserSuspended: bySuspended,
		pruneByUserInactivity: byInactive,
		pruneByUserInactivityLimit: daysToMilliseconds(Math.max(1, inactiveDays,),),
	}), [
		byAge,
		ageDays,
		deselectedKinds,
		pruneArchived,
		effectivePruneAction,
		byDeleted,
		bySuspended,
		byInactive,
		inactiveDays,
	],)

	const preview = useMemo(() => createPrunePreview(usersToRecord(users,), options, colors,), [
		users,
		options,
		colors,
	],)
	const previewUsers = useMemo(() => {
		const grouped = new Map<string, typeof preview.sampleRows>()
		for (const row of preview.sampleRows) {
			grouped.set(row.user, [...(grouped.get(row.user,) ?? []), row,],)
		}
		return [...grouped.entries(),].map(([name, rows,],) => ({name, rows,}))
	}, [preview.sampleRows,],)
	const hasStatusPrune = byDeleted || bySuspended || byInactive
	const canConfirm = byAge || hasStatusPrune

	/** Note count per kind key, derived from the overlay's precomputed stats. */
	const noteCountByKind = useMemo(
		() => new Map(noteStats.typeCounts.map((t,) => [t.key, t.count,]),),
		[noteStats,],
	)

	/** All available note kinds: configured colors first, then the no-type sentinel. */
	const allKinds = useMemo(() => [
		...colors.map((c,) => ({key: c.key, label: c.text, color: c.color as string | undefined,})),
		{key: normalizeKindKey(undefined,), label: 'No type', color: undefined,},
	], [colors,],)

	function toggleKind (key: string,) {
		setDeselectedKinds((prev,) => prev.includes(key,) ? prev.filter((k,) => k !== key) : [...prev, key,])
	}

	async function confirm () {
		if (!canConfirm || isPruning) { return }
		setIsPruning(true,)
		setProgress({stage: 'preparing', message: 'Preparing prune preview...',},)
		try {
			await onConfirm(options, setProgress,)
		} finally {
			setIsPruning(false,)
		}
	}

	return (
		<div className={css.content}>
			<div className={css.scrollableSections}>
				<section className={css.section}>
					<div className={css.sectionTitle}>Note kinds</div>
					<div className={css.sectionDesc}>
						All kinds are included by default. Click a kind to exclude it from pruning.
					</div>
					<div className={css.kindChips}>
						{allKinds.map((kind,) => (
							<button
								key={kind.key}
								type="button"
								disabled={isPruning}
								className={`${css.kindChip}${
									!deselectedKinds.includes(kind.key,) ? ` ${css.kindChipActive}` : ''
								}`}
								onClick={() => toggleKind(kind.key,)}
							>
								{kind.color && (
									<span className={css.kindChipDot} style={{backgroundColor: kind.color,}} />
								)}
								{kind.label}
								<strong>{(noteCountByKind.get(kind.key,) ?? 0).toLocaleString()}</strong>
							</button>
						))}
					</div>
					{deselectedKinds.length > 0 && (
						<div className={css.kindHint}>
							{deselectedKinds.length === allKinds.length
								? 'All kinds are excluded - no notes will match.'
								: `${deselectedKinds.length} ${
									deselectedKinds.length === 1 ? 'kind' : 'kinds'
								} excluded from pruning.`}
						</div>
					)}
				</section>

				<section className={css.section}>
					<div className={css.topRow}>
						<div className={css.topRowColumn}>
							<div className={css.sectionTitle}>Note age</div>
							<CheckboxInput
								label={
									<>
										Prune notes older than{' '}
										<NumberInput
											min={1}
											value={ageDays}
											disabled={isPruning}
											onChange={(event,) => setAgeDays(parseInt(event.target.value || '1', 10,),)}
										/>{' '}
										days
									</>
								}
								checked={byAge}
								disabled={isPruning}
								onChange={(event,) => setByAge(event.target.checked,)}
							/>
						</div>
						<div className={css.topRowColumn}>
							<div className={css.sectionTitle}>Account status</div>
							<CheckboxInput
								label="Prune deleted users (slow)"
								checked={byDeleted}
								disabled={isPruning}
								onChange={(event,) => setByDeleted(event.target.checked,)}
							/>
							<CheckboxInput
								label="Prune permanently suspended users (slow)"
								checked={bySuspended}
								disabled={isPruning}
								onChange={(event,) => setBySuspended(event.target.checked,)}
							/>
							<CheckboxInput
								label="Prune inactive users (slow)"
								checked={byInactive}
								disabled={isPruning}
								onChange={(event,) => setByInactive(event.target.checked,)}
							/>
							{byInactive && (
								<div className={css.inactiveDaysInput}>
									No activity in the last{' '}
									<NumberInput
										min={1}
										value={inactiveDays}
										disabled={isPruning}
										onChange={(event,) =>
											setInactiveDays(parseInt(event.target.value || '1', 10,),)}
									/>{' '}
									days
								</div>
							)}
						</div>
						<div className={css.topRowColumn}>
							<div className={css.sectionTitle}>When pruning</div>
							<div className={css.radioGroup}>
								<label
									className={css.radioOption}
									title="Remove matching notes permanently. On NXG storage, empty user records are kept so note indexes are never reused. On legacy v6 storage, empty records are removed."
								>
									<input
										type="radio"
										name="pruneAction"
										value="delete"
										checked={effectivePruneAction === 'delete'}
										disabled={isPruning}
										onChange={() => setPruneAction('delete',)}
									/>
									Delete
								</label>
								<label
									className={css.radioOption}
									title="Like Delete, but also removes empty user records on NXG storage. Frees more space but note indexes may be reused for that user in future."
								>
									<input
										type="radio"
										name="pruneAction"
										value="purge"
										checked={effectivePruneAction === 'purge'}
										disabled={isPruning}
										onChange={() => setPruneAction('purge',)}
									/>
									Purge
								</label>
								<label
									className={css.radioOption}
									title="Hide matching notes instead of removing them. Archived notes remain in storage and can be viewed or restored."
								>
									<input
										type="radio"
										name="pruneAction"
										value="archive"
										checked={effectivePruneAction === 'archive'}
										disabled={isPruning || pruneArchived === 'only'}
										onChange={() => setPruneAction('archive',)}
									/>
									Archive
								</label>
							</div>
							<div className={css.sectionTitle}>Archived notes</div>
							<div className={css.radioGroup}>
								<label className={css.radioOption}>
									<input
										type="radio"
										name="pruneArchived"
										value="include"
										checked={pruneArchived === 'include'}
										disabled={isPruning}
										onChange={() => setPruneArchived('include',)}
									/>
									Include
								</label>
								<label className={css.radioOption}>
									<input
										type="radio"
										name="pruneArchived"
										value="exclude"
										checked={pruneArchived === 'exclude'}
										disabled={isPruning}
										onChange={() => setPruneArchived('exclude',)}
									/>
									Skip
								</label>
								<label className={css.radioOption}>
									<input
										type="radio"
										name="pruneArchived"
										value="only"
										checked={pruneArchived === 'only'}
										disabled={isPruning}
										onChange={() => setPruneArchived('only',)}
									/>
									Only
								</label>
							</div>
						</div>
					</div>
				</section>

				<section className={css.section}>
					<div className={css.sectionTitle}>Preview</div>
					{preview.prunedNotes === 0 && !hasStatusPrune && (
						<div className={css.emptyPreview}>No notes match the selected pruning rules.</div>
					)}
					{(preview.prunedNotes > 0 || hasStatusPrune) && (
						<>
							<div className={css.previewStats}>
								<span>{preview.prunedNotes} of {preview.totalNotes} notes match age/type rules</span>
								<span>{preview.prunedUsers} of {preview.totalUsers} users would lose all notes</span>
								{hasStatusPrune && <span>Account status checks run before final confirmation</span>}
							</div>
							{previewUsers.length > 0 && (
								<>
									<div className={css.previewUserList}>
										{previewUsers.map((user,) => (
											<div key={user.name} className={css.previewUserEntry}>
												<div className={css.previewUserHeader}>
													<div className={css.previewUserTitle}>
														<a href={`/u/${user.name}`}>/u/{user.name}</a>
														<span>{statLabel(user.rows.length, 'matching note',)}</span>
													</div>
												</div>
												<div className={css.noteList}>
													{user.rows.map((row, rowIndex,) => {
														const color = colors.find((c,) => c.key === row.note.type)
														return (
															<div
																key={`${row.note.time}-${rowIndex}`}
																className={css.noteDetails}
															>
																<span
																	className={css.noteType}
																	style={color ? {color: color.color,} : undefined}
																>
																	{row.kindLabel}
																</span>
																{row.note.link
																	? (
																		<a
																			className={css.noteText}
																			href={row.note.link}
																		>
																			{row.note.note}
																		</a>
																	)
																	: (
																		<span className={css.noteText}>
																			{row.note.note}
																		</span>
																	)}
																<span className={css.modInfo}>
																	by /u/{row.note.mod}
																</span>
																<RelativeTime date={new Date(row.note.time * 1000,)} />
															</div>
														)
													},)}
												</div>
											</div>
										))}
									</div>
									{preview.prunedNotes > preview.sampleRows.length && (
										<div className={css.incompletePreview}>
											... and {preview.prunedNotes - preview.sampleRows.length}{' '}
											more notes (incomplete preview)
										</div>
									)}
								</>
							)}
						</>
					)}
				</section>
			</div>

			{progress && (
				<div className={css.progressPanel}>
					<div className={css.progressText}>
						<strong>{progress.message}</strong>
						{progress.totalUsers != null && (
							<span>
								{progress.checkedUsers ?? 0} / {progress.totalUsers} users checked
								{progress.currentUser ? ` - /u/${progress.currentUser}` : ''}
							</span>
						)}
					</div>
					{progress.totalUsers != null && (
						<div className={css.progressTrack}>
							<span
								style={{
									width: `${
										Math.min(
											100,
											((progress.checkedUsers ?? 0) / Math.max(1, progress.totalUsers,)) * 100,
										)
									}%`,
								}}
							/>
						</div>
					)}
				</div>
			)}

			<div className={css.actions}>
				<ActionButton primary disabled={!canConfirm || isPruning} onClick={confirm}>
					{isPruning ? 'Pruning...' : 'Review and prune'}
				</ActionButton>
			</div>
		</div>
	)
}
