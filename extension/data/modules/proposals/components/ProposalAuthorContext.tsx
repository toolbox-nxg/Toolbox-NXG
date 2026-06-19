/**
 * Collapsible panel that gives the reviewer the same author history the trainee had: the
 * target user's Toolbox usernotes, scoped to the proposal's subreddit. Lazy - nothing is
 * fetched until the reviewer expands it, so the common path (skim the reason,
 * accept/reject) stays cheap.
 */

import {useId, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {classes,} from '../../../util/ui/reactMount'
import type {UserNoteColor, UserNoteEntry,} from '../../../util/wiki/schemas/usernotes/schema'
import {
	activeNotes,
	findSubredditColor,
	getSubredditColors,
	getUser,
	getUserNotes,
} from '../../shared/usernotes/moduleapi'
import {ProposalSpinner,} from './ProposalSpinner'
import css from './ProposalsReviewPopup.module.css'

/** Loaded author history, or `null` while not yet fetched. */
interface AuthorHistory {
	notes: UserNoteEntry[]
	colors: UserNoteColor[]
}

/** One Toolbox usernote, with its type chip colored from the subreddit's palette. */
function UsernoteRow ({note, colors,}: {note: UserNoteEntry; colors: UserNoteColor[]},) {
	const color = note.type ? findSubredditColor(colors, note.type,) : undefined
	return (
		<li className={css.authorNote}>
			{color && (
				<span className={css.itemKind} style={{background: color.color, color: '#fff',}}>{color.text}</span>
			)}
			<span>{note.note}</span>
			<span className={css.itemMeta}>
				u/{note.mod} · <RelativeTime date={new Date(note.time * 1000,)} />
			</span>
		</li>
	)
}

/** Props for the author-context panel. */
interface Props {
	/** The subreddit whose usernotes to read. */
	subreddit: string
	/** Target author username (empty disables the panel). */
	author: string
}

/** Renders the collapsible author-usernotes panel. */
export function ProposalAuthorContext ({subreddit, author,}: Props,) {
	const [expanded, setExpanded,] = useState(false,)
	const [history, setHistory,] = useState<AuthorHistory | null>(null,)
	const [loading, setLoading,] = useState(false,)
	// Set when the lazy fetch fails, so the panel can offer a Retry instead of
	// silently clearing the spinner and leaving the body blank.
	const [error, setError,] = useState(false,)
	const bodyId = useId()

	if (!author) { return null }

	/** Fetches the author's usernotes, once, on first expand (or on Retry). */
	async function load () {
		setLoading(true,)
		setError(false,)
		try {
			const [data, colors,] = await Promise.all([getUserNotes(subreddit,), getSubredditColors(subreddit,),],)
			const found = getUser(data.users, author,)
			const notes = found ? activeNotes(found.notes,) : []
			setHistory({notes, colors,},)
		} catch {
			setError(true,)
		} finally {
			setLoading(false,)
		}
	}

	/** Toggles the panel, kicking off the lazy load the first time it opens. */
	function toggle () {
		const next = !expanded
		setExpanded(next,)
		if (next && !history && !loading) { void load() }
	}

	return (
		<div className={css.authorContext}>
			<button
				type="button"
				className={css.authorToggle}
				aria-expanded={expanded}
				aria-controls={bodyId}
				onClick={toggle}
			>
				<Icon
					icon="arrowRight"
					className={classes(css.authorToggleIcon, expanded && css.authorToggleIconOpen,)}
				/>
				Author usernotes - u/{author}
			</button>
			{expanded && (
				<div className={css.authorBody} id={bodyId}>
					{loading && <ProposalSpinner label="Loading..." />}
					{error && !loading && (
						<div className={css.authorError}>
							<span className={css.empty}>Couldn’t load author history.</span>
							<ActionButton type="button" inline onClick={() => void load()}>Retry</ActionButton>
						</div>
					)}
					{history && history.notes.length === 0 && (
						<span className={css.empty}>No usernotes for this user.</span>
					)}
					{history && history.notes.length > 0 && (
						<ul className={css.authorNoteList}>
							{history.notes.map((note, i,) => (
								<UsernoteRow key={note.index ?? i} note={note} colors={history.colors} />
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	)
}
