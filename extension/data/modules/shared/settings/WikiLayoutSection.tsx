/** Settings section listing every moderated subreddit's wiki layout state with per-sub repair migrations. */

import {useEffect, useState,} from 'react'

import {getModSubs,} from '../../../api/resources/modSubs'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {useBusyState,} from '../../../util/ui/hooks'
import {clearWikiLayoutCache, getCachedWikiLayouts,} from '../../../util/wiki/wikiLayoutCache'
import type {WikiLayout,} from '../../../util/wiki/wikiLayoutCache'
import {migrateSubredditToNxg, summarizeMigrationResult,} from '../../../util/wiki/wikiMigration'
import type {WikiMigrationResult,} from '../../../util/wiki/wikiMigration'
import {peekWikiLayout,} from '../../../util/wiki/wikiPaths'
import css from './SettingsDialog.module.css'

/** Short status label shown next to the subreddit name in the list. */
function shortStatus (layout: WikiLayout,): string {
	if (layout.nxgMissing) { return 'NXG pages missing!' }
	switch (layout.state) {
		case 'legacyFallback':
			return layout.fallbackReason === 'notMod' ? 'Legacy (not a moderator)' : 'Legacy (setup pending)'
		case 'nxg':
			return layout.compatibilityWrites ? 'NXG + 6.x compatibility' : 'NXG only'
	}
}

/** Longer explanation shown when a row is expanded. */
function describeLayout (layout: WikiLayout,): string {
	if (layout.nxgMissing) {
		return 'The NXG wiki pages were deleted from the wiki. Run "Restore from legacy pages" to repair.'
	}
	switch (layout.state) {
		case 'legacyFallback':
			return layout.fallbackReason === 'notMod'
				? 'Using the Toolbox 6.x wiki pages read-only: only moderators can create the toolbox-nxg pages.'
				: 'Using the Toolbox 6.x wiki pages. The toolbox-nxg pages could not be created yet; '
					+ 'setup retries automatically, or run it now with the button below.'
		case 'nxg':
			return `${
				layout.compatibilityWrites
					? 'Data lives under the toolbox-nxg/ wiki pages. The old wiki pages are kept in sync so mods on '
						+ 'Toolbox 6.x keep working; changes they make there flow back into the NXG pages.'
					: 'Data lives under the toolbox-nxg/ wiki pages only. Mods on Toolbox 6.x see stale data.'
			} 6.x compatibility is managed in the subreddit's Toolbox config window.`
	}
}

/**
 * Renders the wiki layout list for every subreddit the user moderates.
 * Statuses come from the local cache where known; expanding a row checks the
 * wiki (which may bootstrap the sub's NXG pages on first touch). Other
 * operations run only on an explicit click.
 */
export function WikiLayoutSection () {
	const [subreddits, setSubreddits,] = useState<string[] | null>(null,)
	const [knownLayouts, setKnownLayouts,] = useState<Record<string, WikiLayout>>({},)

	useEffect(() => {
		void (async () => {
			try {
				const [subs, layouts,] = await Promise.all([getModSubs(false,), getCachedWikiLayouts(),],)
				setKnownLayouts(layouts,)
				setSubreddits(subs,)
			} catch {
				setSubreddits([],)
			}
		})()
	}, [],)

	if (!subreddits) {
		return (
			<div className={css.settingItem}>
				<label className={css.fieldLabel}>Wiki layout</label>
				<span className={css.backupNote}>Loading moderated subreddits...</span>
			</div>
		)
	}

	return (
		<div className={css.settingItem}>
			<label className={css.fieldLabel}>Wiki layout</label>
			<p>
				Toolbox stores its data under each subreddit&apos;s toolbox-nxg/ wiki pages. Subreddits with data from
				Toolbox 6.x keep the old pages in sync while 6.x compatibility is on. Expand a subreddit to check or
				change its state.
			</p>
			{subreddits.length === 0 && <span className={css.backupNote}>You do not moderate any subreddits.</span>}
			{subreddits.map((subreddit,) => (
				<WikiLayoutRow
					key={subreddit}
					subreddit={subreddit}
					initialLayout={knownLayouts[subreddit] ?? null}
				/>
			))}
		</div>
	)
}

/** A single subreddit's wiki layout row: collapsed status line, expandable controls. */
function WikiLayoutRow ({subreddit, initialLayout,}: {subreddit: string; initialLayout: WikiLayout | null},) {
	const [layout, setLayout,] = useState<WikiLayout | null>(initialLayout,)
	const [expanded, setExpanded,] = useState(false,)
	const [checking, setChecking,] = useState(false,)
	const [busy, runBusy,] = useBusyState()
	const [confirming, setConfirming,] = useState<'restore' | null>(null,)
	const [summary, setSummary,] = useState('',)

	const checkLayout = async () => {
		setChecking(true,)
		try {
			setLayout(await peekWikiLayout(subreddit,),)
		} catch {
			negativeTextFeedback(`Could not determine the wiki layout of /r/${subreddit}`,)
		} finally {
			setChecking(false,)
		}
	}

	const toggleExpanded = () => {
		const next = !expanded
		setExpanded(next,)
		setConfirming(null,)
		if (next && !layout && !checking) { void checkLayout() }
	}

	/** Runs a migration-style operation with busy state, summary display, and a status refresh. */
	const runOperation = async (operation: () => Promise<WikiMigrationResult>, successMessage: string,) => {
		setConfirming(null,)
		await runBusy(async () => {
			try {
				const result = await operation()
				setSummary(summarizeMigrationResult(result,),)
				if (result.failed.length === 0) {
					positiveTextFeedback(successMessage,)
				} else {
					negativeTextFeedback(`Failed: ${result.failed[0]!.page} (${result.failed[0]!.reason})`,)
				}
			} catch (error) {
				negativeTextFeedback(String(error,),)
			}
		},)
		await clearWikiLayoutCache(subreddit,)
		await checkLayout()
	}

	const isNxg = layout?.state === 'nxg'
	const compatOn = isNxg && layout.compatibilityWrites && !layout.nxgMissing

	return (
		<div className={css.wikiLayoutRow}>
			<button type="button" className={css.wikiLayoutRowHeader} onClick={toggleExpanded}>
				<span>{expanded ? '▾' : '▸'} /r/{subreddit}</span>
				<span className={css.backupNote}>
					{checking ? 'checking...' : layout ? shortStatus(layout,) : ''}
				</span>
			</button>
			{expanded && layout && (
				<div className={css.wikiLayoutRowBody}>
					<p>{describeLayout(layout,)}</p>
					{layout.state === 'legacyFallback' && layout.fallbackReason !== 'notMod' && (
						<div className={css.backupActions}>
							<ActionButton
								type="button"
								disabled={busy}
								onClick={() =>
									void runOperation(
										() => migrateSubredditToNxg(subreddit,),
										`/r/${subreddit} set up on the NXG wiki layout`,
									)}
							>
								Retry setup
							</ActionButton>
						</div>
					)}
					{isNxg && !compatOn && (
						<div className={css.backupActions}>
							{confirming === 'restore'
								? (
									<>
										<ActionButton
											type="button"
											disabled={busy}
											onClick={() =>
												void runOperation(
													() =>
														migrateSubredditToNxg(subreddit, {
															compatibilityWrites: false,
														},),
													'NXG pages restored from the old wiki pages',
												)}
										>
											Confirm restore
										</ActionButton>
										<ActionButton type="button" onClick={() => setConfirming(null,)}>
											Cancel
										</ActionButton>
										<span className={css.backupNote}>
											⚠ Overwrites the NXG pages with the (possibly stale) old wiki pages!
										</span>
									</>
								)
								: (
									<ActionButton
										type="button"
										disabled={busy || confirming !== null}
										onClick={() => setConfirming('restore',)}
									>
										Restore from legacy pages
									</ActionButton>
								)}
						</div>
					)}
					{busy && <span className={css.backupNote}>Working...</span>}
					{summary && !busy && <span className={css.backupNote}>{summary}</span>}
				</div>
			)}
		</div>
	)
}
