/**
 * Presentational announcement card: the headline / date / body / link visual
 * shared by the live popup (AnnouncementsPopup) and the composer's preview
 * (AnnouncementBuilderPopup). Holds no positioning or seen-tracking - callers
 * supply behavior via props.
 */

import {classes,} from '../../../util/ui/reactMount'
import {isHttpUrl,} from '../noteUtils'
import css from './AnnouncementCard.module.css'

/** The subset of an announcement note this card renders. */
export interface AnnouncementCardNote {
	title: string
	body: string
	link?: string | undefined
	linkLabel?: string | undefined
	/** Go-live time in epoch seconds; rendered as the date when present. */
	publishAt?: number | undefined
}

interface Props {
	note: AnnouncementCardNote
	/** Close handler for the corner ✕. */
	onClose?: (() => void) | undefined
	/** Total notes; a dot pager renders when this is greater than 1. */
	pageCount?: number
	/** Index of the currently shown note (for the pager). */
	pageIndex?: number
	/** Called with a note index when the user clicks a pager dot. */
	onSelectPage?: ((index: number,) => void) | undefined
}

/**
 * Formats an epoch-seconds timestamp as a short, locale-aware date
 * (e.g. "Jun 13, 2026").
 * @param epochSeconds Time in Unix epoch seconds.
 */
export function formatDate (epochSeconds: number,): string {
	return new Date(epochSeconds * 1000,).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	},)
}

/** Renders one announcement note as a card. */
export function AnnouncementCard ({note, onClose, pageCount = 1, pageIndex = 0, onSelectPage,}: Props,) {
	const showPager = pageCount > 1
	// Only ever render an http(s) link as an href; drop other schemes (e.g.
	// `javascript:`) even if a note from the wiki somehow carries one, since this
	// card mounts inside the user's Reddit page.
	const safeLink = note.link && isHttpUrl(note.link,) ? note.link : undefined

	return (
		<div className={css.card}>
			<button
				type="button"
				className={css.close}
				// Stop propagation so closing a card that sits inside a clickable
				// wrapper (e.g. page notifications) doesn't also trigger the wrapper.
				onClick={(event,) => {
					event.stopPropagation()
					onClose?.()
				}}
				aria-label="Close announcement"
			>
				✕
			</button>
			<h2 className={css.title}>{note.title}</h2>
			{note.publishAt != null && <div className={css.date}>{formatDate(note.publishAt,)}</div>}
			<p className={css.body}>{note.body}</p>
			{(safeLink || showPager) && (
				<div className={css.actions}>
					{safeLink && (
						<a className={css.link} href={safeLink} target="_blank" rel="noreferrer">
							{note.linkLabel ?? 'Read more'}
						</a>
					)}
					{showPager && (
						<div className={css.pager}>
							{Array.from({length: pageCount,}, (_unused, i,) => (
								<button
									key={i}
									type="button"
									className={classes(css.dot, i === pageIndex && css.dotActive,)}
									aria-label={`Announcement ${i + 1} of ${pageCount}`}
									aria-current={i === pageIndex}
									onClick={() => onSelectPage?.(i,)}
								/>
							),)}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
