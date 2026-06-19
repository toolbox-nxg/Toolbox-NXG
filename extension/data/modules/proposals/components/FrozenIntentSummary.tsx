/**
 * Renders the "what happens on accept" panel for a proposal's captured action - the
 * piece the old drawer was missing. For a removal-reasons proposal it shows the exact
 * composed message the author would receive (rendered as markdown) plus a list of the
 * side effects the reviewer is approving (delivery mode, flair, usernote, ban, locks,
 * log). For ban/mute it shows the captured details. Everything is read straight off the
 * frozen intent / action - no fetching - and only fields that are present are shown
 * (the intent is curated to omit defaults, so "present" == "meaningful").
 */

import {type ReactNode, useMemo,} from 'react'

import type {FrozenReasonType, FrozenRemovalIntent, ProposedAction,} from '../../../util/wiki/schemas/proposals/schema'
import type {UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import css from './ProposalsReviewPopup.module.css'

/** One label/value row in an effects list; renders nothing when `value` is empty. */
function Effect ({label, value,}: {label: string; value: ReactNode},) {
	if (value === undefined || value === null || value === false || value === '') { return null }
	return (
		<>
			<dt>{label}</dt>
			<dd>{value === true ? 'Yes' : value}</dd>
		</>
	)
}

/** Usernote type rendered as a colored chip (matching the usernotes palette) when known. */
function UsernoteTypeChip ({typeKey, color,}: {typeKey: string; color?: UserNoteColor | undefined},) {
	return (
		<span
			className={css.usernoteChip}
			style={color ? {background: color.color, color: '#fff',} : undefined}
		>
			{color ? color.text : typeKey}
		</span>
	)
}

/** Human label for how the removal message is delivered. */
function deliveryLabel (reasonType: FrozenReasonType,): string {
	switch (reasonType) {
		case 'reply':
			return 'Reply on the thread'
		case 'pm':
			return 'Private message'
		case 'both':
			return 'Reply + private message'
		case 'none':
			return 'No message sent'
	}
}

/** Joins the present flair fields into a readable one-liner. */
function flairSummary (flair: NonNullable<FrozenRemovalIntent['flair']>,): string {
	return [flair.text, flair.cssClass && `.${flair.cssClass}`, flair.templateId && `(template)`,]
		.filter(Boolean,)
		.join(' ',)
}

/** The removal message + every captured side effect for a removal-reasons proposal. */
function RemovalReasonSummary (
	{intent, usernoteColor,}: {intent: FrozenRemovalIntent; usernoteColor?: UserNoteColor | undefined},
) {
	const parser = useMemo(() => getRemovalReasonParser(), [],)
	const html = useMemo(() => parser.render(intent.reasonText,), [parser, intent.reasonText,],)
	return (
		<div className={css.intentSummary}>
			<div className={css.sectionHeading}>Removal message</div>
			{intent.reasonTitle && <div className={css.reasonTitle}>{intent.reasonTitle}</div>}
			<div
				className={css.reasonBody}
				// Composed reason text is token-substituted at capture; render as markdown.
				dangerouslySetInnerHTML={{__html: html,}}
			/>
			<div className={css.sectionHeading}>On accept</div>
			<dl className={css.detailMeta}>
				<Effect label="Delivery" value={deliveryLabel(intent.reasonType,)} />
				{(intent.reasonType === 'pm' || intent.reasonType === 'both') && (
					<Effect label="Subject" value={intent.subject} />
				)}
				<Effect label="Sticky reply" value={intent.reasonSticky} />
				<Effect label="Reply as subreddit" value={intent.reasonCommentAsSubreddit} />
				<Effect label="PM as subreddit" value={intent.reasonAsSub} />
				<Effect label="Auto-archive modmail" value={intent.reasonAutoArchive} />
				<Effect label="Lock thread" value={intent.actionLockThread} />
				<Effect label="Lock reply" value={intent.actionLockComment} />
				{intent.flair && <Effect label="Flair" value={flairSummary(intent.flair,)} />}
				{intent.usernote && (
					<Effect
						label="Usernote"
						value={
							<span className={css.usernoteValue}>
								<span>{intent.usernote.text}</span>
								{intent.usernote.type && (
									<UsernoteTypeChip typeKey={intent.usernote.type} color={usernoteColor} />
								)}
							</span>
						}
					/>
				)}
				{intent.ban && (
					<Effect
						label="Ban"
						value={`${intent.ban.permanent ? 'Permanent' : `${intent.ban.days}d`}${
							intent.ban.note ? ` - ${intent.ban.note}` : ''
						}`}
					/>
				)}
				{intent.logSub && <Effect label="Log to" value={`r/${intent.logSub}`} />}
			</dl>
		</div>
	)
}

/**
 * Renders the captured details of a proposed action, so the reviewer sees what they
 * are approving. Returns `null` for actions whose label already says everything (e.g.
 * approve/lock), since the detail title already shows them.
 */
export function FrozenIntentSummary (
	{action, usernoteColor,}: {action: ProposedAction; usernoteColor?: UserNoteColor | undefined},
) {
	switch (action.type) {
		case 'removal-reason':
			return <RemovalReasonSummary intent={action.intent} usernoteColor={usernoteColor} />
		case 'ban':
			return (
				<dl className={css.detailMeta}>
					<Effect label="Duration" value={action.permanent ? 'Permanent' : `${action.days} days`} />
					<Effect label="Mod note" value={action.note} />
					<Effect label="Ban message" value={action.message} />
				</dl>
			)
		case 'mute':
			return (
				<dl className={css.detailMeta}>
					<Effect label="Duration" value={action.duration ? `${action.duration} days` : undefined} />
					<Effect label="Mod note" value={action.note} />
				</dl>
			)
		default:
			return null
	}
}
