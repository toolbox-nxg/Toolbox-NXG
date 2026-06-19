/** Form popup for composing, scheduling, and editing a toolbox announcement. */

import {useMemo, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {Backdrop,} from '../../../shared/window/Backdrop'
import {Window,} from '../../../shared/window/Window'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {nowInSeconds,} from '../../../util/data/time'
import {mountPopup,} from '../../../util/ui/reactMount'
import {isHttpUrl,} from '../noteUtils'
import {publishAnnouncement, updateAnnouncement,} from '../publish'
import type {AnnouncementNote,} from '../types'
import css from './AnnouncementBuilderPopup.module.css'
import {AnnouncementCard, type AnnouncementCardNote,} from './AnnouncementCard'

/** The build types a note can target, in display order. (Dev is excluded - the
 *  display path no-ops on dev builds, so dev-targeted notes never show.) */
const BUILD_TYPES = ['stable', 'beta',] as const
type BuildType = typeof BUILD_TYPES[number]

interface Props {
	/** Closes (unmounts) the popup. */
	onClose: () => void
	/**
	 * Absolute URL of the post the composer button was attached to. When set (and
	 * not editing), it is the announcement's link and the manual link field is
	 * hidden.
	 */
	postLink?: string | undefined
	/** When provided, the form edits this existing note instead of creating one. */
	initialNote?: AnnouncementNote | undefined
	/** Called after a successful save, so an opener (e.g. the manager) can refresh. */
	onSaved?: (() => void) | undefined
}

/**
 * Parses a `datetime-local` input value (local time) into epoch seconds, or
 * `undefined` if empty/unparseable.
 * @param value The raw input value (e.g. "2026-06-20T14:30").
 */
function parseSchedule (value: string,): number | undefined {
	if (!value) { return undefined }
	const ms = new Date(value,).getTime()
	return Number.isNaN(ms,) ? undefined : Math.floor(ms / 1000,)
}

/**
 * Formats epoch seconds as a `datetime-local` input value in local time
 * (e.g. "2026-06-20T14:30"), for pre-filling the schedule field when editing.
 * @param epochSeconds Time in Unix epoch seconds.
 */
function toDatetimeLocal (epochSeconds: number,): string {
	const d = new Date(epochSeconds * 1000,)
	const pad = (n: number,) => String(n,).padStart(2, '0',)
	return `${d.getFullYear()}-${pad(d.getMonth() + 1,)}-${pad(d.getDate(),)}T${pad(d.getHours(),)}:${
		pad(d.getMinutes(),)
	}`
}

/**
 * Returns `true` if `value` is empty/whitespace or an absolute `http(s)` URL. The
 * link is optional, but a non-empty one must be a safe web URL - other schemes
 * (e.g. `javascript:`) are rejected so they can never reach the rendered `href`.
 * @param value The raw link field value.
 */
function isLinkValid (value: string,): boolean {
	if (!value.trim()) { return true }
	return isHttpUrl(value.trim(),)
}

/**
 * Renders the announcement composer with a live card preview. Creates a new note
 * (optionally scheduled or linked to the attached post) or, when `initialNote`
 * is given, edits a still-scheduled one.
 */
export function AnnouncementBuilderPopup ({onClose, postLink, initialNote, onSaved,}: Props,) {
	const editing = initialNote != null
	// A post-attached new announcement uses the post URL and hides the link field;
	// standalone and editing flows expose an optional manual link instead.
	const isPostLinked = !!postLink && !editing

	const [title, setTitle,] = useState(initialNote?.title ?? '',)
	const [body, setBody,] = useState(initialNote?.body ?? '',)
	const [link, setLink,] = useState(initialNote?.link ?? '',)
	const [linkLabel, setLinkLabel,] = useState(initialNote?.linkLabel ?? '',)
	const [schedule, setSchedule,] = useState(
		initialNote?.publishAt != null ? toDatetimeLocal(initialNote.publishAt,) : '',
	)
	const [builds, setBuilds,] = useState<Set<BuildType>>(new Set(initialNote?.buildTypes ?? [],),)
	const [saving, setSaving,] = useState(false,)

	const scheduledEpoch = useMemo(() => parseSchedule(schedule,), [schedule,],)
	const linkValid = isPostLinked || isLinkValid(link,)
	const canSave = title.trim().length > 0 && body.trim().length > 0 && linkValid && !saving

	/** The effective link: the attached post, or the manual field. */
	const effectiveLink = isPostLinked ? postLink : (link.trim() || undefined)

	/** Toggles a build type in the targeting set. */
	const toggleBuild = (build: BuildType,) => {
		setBuilds((prev,) => {
			const next = new Set(prev,)
			if (next.has(build,)) { next.delete(build,) }
			else { next.add(build,) }
			return next
		},)
	}

	// The note as it will be written. `id` and a default `publishAt` are assigned
	// by the publish/update call; a future `publishAt` here schedules it.
	const note = useMemo<Omit<AnnouncementNote, 'id'>>(() => {
		const result: Omit<AnnouncementNote, 'id'> = {
			title: title.trim(),
			body: body.trim(),
		}
		if (effectiveLink) { result.link = effectiveLink }
		if (linkLabel.trim()) { result.linkLabel = linkLabel.trim() }
		// Omit buildTypes when none are selected so the note shows on all builds.
		if (builds.size > 0) {
			result.buildTypes = BUILD_TYPES.filter((b,) => builds.has(b,))
		}
		if (scheduledEpoch != null) { result.publishAt = scheduledEpoch }
		return result
	}, [title, body, effectiveLink, linkLabel, builds, scheduledEpoch,],)

	// What the announcement will look like: placeholders fill empty fields, and
	// the date shown is the scheduled time (or now, for an immediate publish).
	const previewNote: AnnouncementCardNote = {
		title: title.trim() || 'Untitled announcement',
		body: body.trim() || 'Announcement body...',
		link: effectiveLink,
		linkLabel: linkLabel.trim() || undefined,
		publishAt: scheduledEpoch ?? nowInSeconds(),
	}

	/** Publishes, schedules, or saves edits, and reports the outcome. */
	const handleSave = async () => {
		if (!canSave) { return }
		setSaving(true,)
		neutralTextFeedback(
			editing
				? 'Saving changes...'
				: scheduledEpoch
				? 'Scheduling announcement...'
				: 'Publishing announcement...',
		)
		const result = editing
			? await updateAnnouncement(initialNote.id, note,)
			: await publishAnnouncement(note,)
		setSaving(false,)
		if (result.ok) {
			positiveTextFeedback(
				editing ? 'Announcement updated' : scheduledEpoch ? 'Announcement scheduled' : 'Announcement published',
			)
			onSaved?.()
			onClose()
		} else {
			negativeTextFeedback(result.reason, {duration: 8000,},)
		}
	}

	const footer = (
		<>
			<ActionButton onClick={onClose} disabled={saving}>Cancel</ActionButton>
			<ActionButton primary onClick={handleSave} disabled={!canSave}>
				{saving ? 'Working...' : editing ? 'Save changes' : scheduledEpoch ? 'Schedule' : 'Publish'}
			</ActionButton>
		</>
	)

	return (
		<Backdrop
			onClickOutside={() => {
				if (!saving) { onClose() }
			}}
		>
			<Window
				title={editing ? 'Edit announcement' : 'New announcement'}
				footer={footer}
				closable
				onClose={onClose}
				className={css.window}
			>
				<div className={css.body}>
					<div className={css.form}>
						<label className={css.field}>
							<span className={css.label}>Title</span>
							<TextInput
								value={title}
								onChange={(e,) => setTitle(e.target.value,)}
								placeholder="Short headline"
							/>
						</label>

						<TextareaInput
							label="Body"
							rows={4}
							value={body}
							onChange={(e,) => setBody(e.target.value,)}
							placeholder="1–3 sentences, plain text (no markdown)"
						/>

						{!isPostLinked && (
							<label className={css.field}>
								<span className={css.label}>Link (optional)</span>
								<TextInput
									value={link}
									onChange={(e,) => setLink(e.target.value,)}
									placeholder="https://..."
								/>
								{!linkValid && <span className={css.error}>Not a valid URL.</span>}
							</label>
						)}

						{(isPostLinked || link.trim()) && (
							<label className={css.field}>
								<span className={css.label}>Link label (optional)</span>
								<TextInput
									value={linkLabel}
									onChange={(e,) => setLinkLabel(e.target.value,)}
									placeholder="Read more"
								/>
								<span className={css.hint}>
									{isPostLinked ? 'Links to this post; ' : ''}leave blank for "Read more".
								</span>
							</label>
						)}

						<label className={css.field}>
							<span className={css.label}>Schedule (optional)</span>
							<TextInput
								type="datetime-local"
								value={schedule}
								onChange={(e,) => setSchedule(e.target.value,)}
							/>
							<span className={css.hint}>Leave empty to publish immediately.</span>
						</label>

						<div className={css.field}>
							<span className={css.label}>Show on builds</span>
							<div className={css.builds}>
								{BUILD_TYPES.map((build,) => (
									<CheckboxInput
										key={build}
										label={build}
										checked={builds.has(build,)}
										onChange={() => toggleBuild(build,)}
									/>
								))}
							</div>
							<span className={css.hint}>Leave all unchecked to show on every build.</span>
						</div>
					</div>

					<div className={css.previewPane}>
						<span className={css.label}>Preview</span>
						<div className={css.preview}>
							<AnnouncementCard note={previewNote} />
						</div>
					</div>
				</div>
			</Window>
		</Backdrop>
	)
}

/**
 * Imperatively mounts the announcement composer. Deduplicates per note (so two
 * edits of different notes don't collide, but re-opening the same one reveals it).
 * @param opts.postLink Attached post URL for a new post-linked announcement.
 * @param opts.initialNote Existing note to edit instead of creating one.
 * @param opts.onSaved Called after a successful save (e.g. to refresh a list).
 */
export function openAnnouncementBuilder (
	opts: {
		postLink?: string | undefined
		initialNote?: AnnouncementNote | undefined
		onSaved?: (() => void) | undefined
	} = {},
) {
	const key = opts.initialNote ? `announcement-builder:${opts.initialNote.id}` : 'announcement-builder:new'
	mountPopup(
		(onClose,) => (
			<AnnouncementBuilderPopup
				onClose={onClose}
				postLink={opts.postLink}
				initialNote={opts.initialNote}
				onSaved={opts.onSaved}
			/>
		),
		undefined,
		key,
	)
}
