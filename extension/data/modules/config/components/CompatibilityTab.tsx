/** Subreddit config tab for managing Toolbox 6.x compatibility (the legacy wiki page mirror). */
import {useEffect, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {useBusyState,} from '../../../util/ui/hooks'
import {clearWikiLayoutCache,} from '../../../util/wiki/wikiLayoutCache'
import type {WikiLayout,} from '../../../util/wiki/wikiLayoutCache'
import {copyNxgToLegacy, setCompatibilityMode, summarizeMigrationResult,} from '../../../util/wiki/wikiMigration'
import type {WikiMigrationResult,} from '../../../util/wiki/wikiMigration'
import {peekWikiLayout,} from '../../../util/wiki/wikiPaths'
import css from './CompatibilityTab.module.css'

/** Props for the CompatibilityTab component. */
interface Props {
	/** The subreddit whose 6.x compatibility is being managed. */
	subreddit: string
}

/** Explains the subreddit's current compatibility state. */
function describeCompat (layout: WikiLayout,): string {
	if (layout.nxgMissing) {
		return 'The toolbox-nxg wiki pages are missing. Restore them from the Toolbox settings (Wiki layout section) '
			+ 'before managing 6.x compatibility.'
	}
	if (layout.state === 'legacyFallback') {
		return 'This subreddit still uses the Toolbox 6.x wiki pages directly; 6.x compatibility does not apply '
			+ 'until it is set up on the NXG wiki layout from the Toolbox settings (Wiki layout section).'
	}
	return layout.compatibilityWrites
		? 'Data lives under the toolbox-nxg/ wiki pages. The old wiki pages are kept in sync so mods on '
			+ 'Toolbox 6.x keep working; changes they make there flow back into the NXG pages.'
		: 'Data lives under the toolbox-nxg/ wiki pages only. Mods on Toolbox 6.x see stale data.'
}

/**
 * Renders the 6.x compatibility controls for one subreddit: the current
 * state, a toggle with explicit confirmation in both directions, and a
 * manual mirror refresh while compatibility is on.
 */
export function CompatibilityTab ({subreddit,}: Props,) {
	const [layout, setLayout,] = useState<WikiLayout | null>(null,)
	const [checking, setChecking,] = useState(true,)
	const [busy, runBusy,] = useBusyState()
	const [confirming, setConfirming,] = useState<'compat-on' | 'compat-off' | null>(null,)
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

	useEffect(() => {
		void checkLayout()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [],)

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
					const firstError = result.failed[0]
					negativeTextFeedback(
						`Failed: ${firstError?.page ?? 'unknown'} (${firstError?.reason ?? 'unknown'})`,
					)
				}
			} catch (error) {
				negativeTextFeedback(String(error,),)
			}
		},)
		await clearWikiLayoutCache(subreddit,)
		await checkLayout()
	}

	if (checking && !layout) {
		return <p className={css.note}>Checking the wiki layout of /r/{subreddit}...</p>
	}
	if (!layout) {
		return <p className={css.note}>Could not determine the wiki layout of /r/{subreddit}.</p>
	}

	const togglable = layout.state === 'nxg' && !layout.nxgMissing
	const compatOn = togglable && layout.compatibilityWrites

	return (
		<div className={css.root}>
			<p className={css.description}>{describeCompat(layout,)}</p>
			{togglable && (
				<CheckboxInput
					label="Toolbox 6.x compatibility (old wiki pages kept in sync for 6.x mods)"
					checked={compatOn}
					disabled={busy || confirming !== null}
					onChange={(event,) => setConfirming(event.target.checked ? 'compat-on' : 'compat-off',)}
				/>
			)}
			{confirming === 'compat-off' && (
				<div className={css.actions}>
					<ActionButton
						type="button"
						disabled={busy}
						onClick={() =>
							runOperation(
								() => setCompatibilityMode(subreddit, false,),
								'6.x compatibility disabled - the old wiki pages are no longer updated',
							)}
					>
						Disable 6.x compatibility
					</ActionButton>
					<ActionButton type="button" onClick={() => setConfirming(null,)}>Cancel</ActionButton>
					<span className={css.note}>
						⚠ Mods still on Toolbox 6.x will stop seeing new changes!
					</span>
				</div>
			)}
			{confirming === 'compat-on' && (
				<div className={css.actions}>
					<ActionButton
						type="button"
						disabled={busy}
						onClick={() =>
							runOperation(
								() => setCompatibilityMode(subreddit, true,),
								'6.x compatibility enabled - old wiki pages restored and kept in sync',
							)}
					>
						Enable 6.x compatibility
					</ActionButton>
					<ActionButton type="button" onClick={() => setConfirming(null,)}>Cancel</ActionButton>
					<span className={css.note}>
						Copies the current NXG data back to the old wiki pages first. Archived usernotes stay NXG-only
						(6.x mods won&apos;t see them), and notes deleted from 6.x are archived here rather than lost.
						Active usernotes are capped by the old page&apos;s 1MB limit - enabling compatibility fails past
						that.
					</span>
				</div>
			)}
			{compatOn && (
				<div className={css.actions}>
					<ActionButton
						type="button"
						disabled={busy || confirming !== null}
						onClick={() =>
							runOperation(
								() => copyNxgToLegacy(subreddit,),
								'6.x mirror refreshed from the NXG pages',
							)}
					>
						Refresh 6.x mirror now
					</ActionButton>
				</div>
			)}
			{busy && <span className={css.note}>Working...</span>}
			{summary && !busy && <span className={css.note}>{summary}</span>}
		</div>
	)
}
