/**
 * Pure helpers for the removal-reasons overlay: wiki-text-to-UI rendering
 * (including the `{choice}` -> radio-group and tick-box -> checkbox-group pipelines), reason-text
 * composition, and small mapping utilities.
 *
 * Reason text is the schema v2 token form (`{input: ...}`, `{textarea: ...}`,
 * and `{choice}` blocks whose options are the markdown list below the marker).
 * Legacy limited-HTML text is accepted too - it is up-converted to tokens
 * (rewriting `<select>`s into `{choice}` blocks) before rendering - so
 * unmigrated `getfrom` targets and stale caches keep working. The rendered
 * controls are unchanged from the legacy pipeline, so existing configs display
 * identically.
 */

import {
	encodeTicks,
	findUnfilledRequired,
	htmlFieldsToTokens,
	type InteractiveToken,
	isToggleKind,
	type LiteralField,
	parseReasonSegments,
	substituteTokenValues,
	tokenToLegacyHtml,
} from '../../../util/wiki/schemas/shared/tokens'
import {type getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import {type RemovalReason,} from '../schema'

/** Counter for generating unique radio group `name` attributes across all rendered reason cards. */
let radioGroupCounter = 0

/** Default id prefix for an id-less `{choice}` block; overridden per-reason so ids stay stable. */
const DEFAULT_ANON_CHOICE_PREFIX = 'toolbox-anon-choice'

/** How the removal reason message will be delivered to the author. */
export type ReasonType = 'reply' | 'pm' | 'both' | 'none'

/** A removal reason with its pre-rendered markdown and HTML. */
export interface RenderedReason {
	/** Stable key used as the dnd-kit sort ID. */
	id: string
	reason: RemovalReason
	/** Raw markdown string with a trailing newline, healed to token form. */
	markdown: string
	/** Pre-rendered HTML for display. */
	html: string
}

// Error messages
export const statusDefaultText = 'saving...'
export const removeError = 'failed to remove item'
export const flairError = 'failed to flair post'
export const noReasonError = 'no reason selected'
export const noReplyTypeError = 'no reply type selected'
export const replyError = 'failed to post reply'
export const replyErrorSubreddit = 'failed to post reply as ModTeam account'
export const modmailError = 'failed to send Modmail'
export const modmailArchiveError = 'failed to archive sent Modmail'
export const distinguishError = 'failed to distinguish reply'
export const lockPostError = 'failed to lock post'
export const lockCommentError = 'failed to lock reply'
export const logReasonMissingError = 'public log reason missing'
export const logPostError = 'failed to create log post'
export const usernoteError = 'failed to save usernote'
export const nativeNoteError = 'failed to save Reddit mod note'
export const banError = 'failed to issue ban'
/** The ban went through but removing the user's other content was refused (training mode) or failed. */
export const removeAllError = 'banned, but failed to remove the other posts and comments by this user'
export const nativeReasonError = 'failed to register native removal reason'

/** Class marking a required field the moderator left unfilled on a send attempt. */
export const missingFieldClass = 'toolbox-field-missing'

/**
 * The status message for a send blocked by unfilled required fields.
 * @param titles The titles of the reasons holding them (undefined for an untitled reason).
 */
export function requiredFieldsError (titles: Array<string | undefined>,): string {
	const named = titles.filter((title,): title is string => !!title)
	return named.length > 0
		? `fill in the required fields in: ${named.join(', ',)}`
		: 'fill in the required fields in the selected reason'
}

/**
 * Renders a `{choice}` token as a radio button group.
 * Each option string is both the inserted value and the visible label; labels
 * are rendered as markdown so options can contain links and emphasis. Any
 * prompt is plain markdown text above the block, rendered as normal markdown
 * rather than by this function.
 * A `<input type="hidden">` inside the wrapper tracks the selected value for the save logic.
 * An inline choice (`{choice: a | b}`) renders as a `span` wrapper so it can sit inside a
 * paragraph; it is otherwise identical.
 * @param parser SnuOwnd parser instance for rendering option markdown labels.
 * @param token The parsed choice token.
 * @param anonId Stable id to use when the choice has no explicit `#id`. Derived from the reason's
 *   position and the choice's position so the selection persists across overlay reopens (a mutable
 *   counter would change each render and orphan the cached value).
 * @returns HTML string containing a `.toolbox-radio-group` element with a hidden input inside.
 */
export function choiceTokenToRadioGroup (
	parser: ReturnType<typeof getRemovalReasonParser>,
	token: InteractiveToken,
	anonId: string,
): string {
	const doc = new DOMParser().parseFromString('', 'text/html',)

	const selectId = token.id || anonId
	// The `name` only groups radios within one block; it needs page-uniqueness, not stability, so the
	// mutable counter is fine here (unlike `selectId`, which keys the persisted selection).
	const groupName = `toolbox-rg-${selectId}-${radioGroupCounter++}`

	const wrapper = doc.createElement(token.inline ? 'span' : 'div',)
	wrapper.className = [
		'toolbox-radio-group',
		...token.inline ? ['toolbox-radio-group-inline',] : [],
		...token.required ? ['toolbox-field-required',] : [],
	].join(' ',)

	token.options.forEach((option, optionIdx,) => {
		const label = doc.createElement('label',)
		label.className = 'toolbox-radio-label'

		const radio = doc.createElement('input',)
		radio.type = 'radio'
		radio.className = 'toolbox-radio-input'
		radio.name = groupName
		radio.value = option
		radio.dataset.syncSelect = selectId
		if (optionIdx === 0) { radio.setAttribute('checked', '',) }

		const span = doc.createElement('span',)
		span.className = 'toolbox-radio-text'
		span.innerHTML = renderLabelMarkdown(parser, option,)
		unwrapLinks(span,)

		label.appendChild(radio,)
		label.appendChild(span,)
		wrapper.appendChild(label,)
	},)

	// Hidden input tracks the selected value for the save logic (queried as
	// `input:not([type="radio"])` in handleSave, and `input[id]` in the pre-fill effect).
	const hiddenInput = doc.createElement('input',)
	hiddenInput.type = 'hidden'
	hiddenInput.id = selectId
	hiddenInput.value = token.options[0] ?? ''
	wrapper.appendChild(hiddenInput,)

	return wrapper.outerHTML
}

/**
 * Renders a `{dropdown}` (a choice with `dropdown` set) as a `<select>`. The `<select>`
 * carries the id itself, so unlike the radio group it needs no hidden input: the overlay
 * reads its value directly, the way it read 6.x's own `<select>` fields. Options are
 * plain text, since an `<option>` can't hold markup; a markdown link shows as its text,
 * and the option's full text is still what gets sent.
 * @param parser SnuOwnd parser instance, for reducing option markdown to its visible text.
 * @param token The parsed choice token.
 * @param anonId Stable id to use when the choice has no explicit `#id` (see
 *   {@link choiceTokenToRadioGroup}).
 * @returns HTML string containing a `.toolbox-reason-select` element.
 */
export function choiceTokenToDropdown (
	parser: ReturnType<typeof getRemovalReasonParser>,
	token: InteractiveToken,
	anonId: string,
): string {
	const doc = new DOMParser().parseFromString('', 'text/html',)
	const select = doc.createElement('select',)
	select.id = token.id || anonId
	select.className = [
		'toolbox-reason-select',
		...token.required ? ['toolbox-field-required',] : [],
	].join(' ',)
	token.options.forEach((option, optionIdx,) => {
		const element = doc.createElement('option',)
		element.value = option
		const label = doc.createElement('span',)
		label.innerHTML = renderLabelMarkdown(parser, option,)
		element.textContent = label.textContent || option
		if (optionIdx === 0) { element.setAttribute('selected', '',) }
		select.appendChild(element,)
	},)
	// A block dropdown sits on a line of its own, as the radio group does.
	if (token.inline) { return select.outerHTML }
	const wrapper = doc.createElement('div',)
	wrapper.className = 'toolbox-reason-select-block'
	wrapper.appendChild(select,)
	return wrapper.outerHTML
}

/**
 * Renders a tick-box token (`{multi}` / `{highlight}` block, or an inline `{check: ...}` /
 * `{highlight: ...}`) as a group of checkboxes, one per item, starting from the template's
 * `[x]` ticks. It reuses the radio group's classes so it shares that layout and the card's
 * click guard; `toolbox-check-group` marks it as tick boxes, and `toolbox-check-highlight`
 * lets CSS preview a ticked highlight item in bold.
 * A `<input type="hidden">` inside the wrapper carries the tick state (`encodeTicks`) for
 * the save logic and the persisted value; `substituteTokenValues` turns it into markdown.
 * @param parser SnuOwnd parser instance for rendering item markdown labels.
 * @param token The parsed tick-box token.
 * @param anonId Stable id to use when the token has no explicit `#id` (see
 *   {@link choiceTokenToRadioGroup}).
 * @returns HTML string containing a `.toolbox-check-group` element with a hidden input inside.
 */
export function toggleTokenToCheckboxGroup (
	parser: ReturnType<typeof getRemovalReasonParser>,
	token: InteractiveToken,
	anonId: string,
): string {
	const doc = new DOMParser().parseFromString('', 'text/html',)
	const groupId = token.id || anonId

	const wrapper = doc.createElement(token.inline ? 'span' : 'div',)
	wrapper.className = [
		'toolbox-radio-group',
		'toolbox-check-group',
		...token.inline ? ['toolbox-radio-group-inline',] : [],
		...token.kind === 'highlight' ? ['toolbox-check-highlight',] : [],
		...token.required ? ['toolbox-field-required',] : [],
	].join(' ',)

	token.options.forEach((option, optionIdx,) => {
		const label = doc.createElement('label',)
		label.className = 'toolbox-radio-label'

		const box = doc.createElement('input',)
		box.type = 'checkbox'
		box.className = 'toolbox-radio-input'
		box.value = String(optionIdx,)
		box.dataset.syncChecks = groupId
		if (token.checked?.[optionIdx]) { box.setAttribute('checked', '',) }

		const span = doc.createElement('span',)
		span.className = 'toolbox-radio-text'
		span.innerHTML = renderLabelMarkdown(parser, option,)
		unwrapLinks(span,)

		label.appendChild(box,)
		label.appendChild(span,)
		wrapper.appendChild(label,)
	},)

	const hiddenInput = doc.createElement('input',)
	hiddenInput.type = 'hidden'
	hiddenInput.id = groupId
	hiddenInput.value = encodeTicks(token.checked ?? [],)
	wrapper.appendChild(hiddenInput,)

	return wrapper.outerHTML
}

/**
 * Renders an option or item label as markdown, stripping the single outer block wrapper
 * so the content sits inline with its radio button or checkbox.
 */
function renderLabelMarkdown (parser: ReturnType<typeof getRemovalReasonParser>, option: string,): string {
	const labelHtml = parser.render(option,).trim()
		.replace(/^<(?:ul|ol)>\s*<li>([\s\S]+)<\/li>\s*<\/(?:ul|ol)>$/, '$1',)
		.replace(/^<p>([\s\S]+)<\/p>$/, '$1',)
	return labelHtml || option
}

/**
 * Renders a `{note}` as moderator-only guidance: a muted inline span, with its text as
 * inline markdown so it can carry a link. It holds no form control, so it takes no value
 * slot, matching `substituteTokenValues`, which sends nothing for it.
 * @param parser SnuOwnd parser instance for rendering the note's markdown.
 * @param token The parsed note token.
 */
export function noteTokenToHtml (parser: ReturnType<typeof getRemovalReasonParser>, token: InteractiveToken,): string {
	const doc = new DOMParser().parseFromString('', 'text/html',)
	const span = doc.createElement('span',)
	span.className = 'toolbox-reason-note'
	span.title = 'Note for moderators - not sent'
	span.innerHTML = renderLabelMarkdown(parser, token.placeholder,)
	return span.outerHTML
}

/**
 * Stand-in for an inline choice while its paragraph goes through the markdown render.
 * Letters only (followed by an index and a closing `Q`), so markdown leaves it untouched.
 */
const inlineChoicePlaceholder = 'TBXINLINECHOICE'

/** Matches a rendered {@link inlineChoicePlaceholder}; group 1 is its index. */
const inlineChoicePlaceholderRe = new RegExp(`${inlineChoicePlaceholder}(\\d+)Q`, 'g',)

/**
 * Replaces a link with a `span` holding the same content, the URL kept as its tooltip,
 * so a click on it reaches the radio button or tick box it labels instead of following
 * the link. Only the overlay's display changes - the sent markdown keeps the link.
 */
function unwrapLink (anchor: Element,): void {
	const span = anchor.ownerDocument.createElement('span',)
	span.className = 'toolbox-choice-link'
	const href = anchor.getAttribute('href',)
	if (href) { span.title = href }
	span.append(...Array.from(anchor.childNodes,),)
	anchor.replaceWith(span,)
}

/**
 * Unwraps every link in an option or item label (see {@link unwrapLink}), so a click
 * anywhere on the option's line picks it. A `{note}` keeps its links: it is guidance
 * for the moderator, who may want to follow them.
 */
function unwrapLinks (label: Element,): void {
	label.querySelectorAll('a',).forEach(unwrapLink,)
}

/**
 * Unwraps any link that contains an inline choice (see {@link unwrapLink}). A choice
 * used as a link's text would otherwise sit inside an anchor, and clicking an option
 * would follow the link instead of picking it.
 */
function unwrapLinksAroundChoices (html: string,): string {
	if (!html.includes('<a',)) { return html }
	const doc = new DOMParser().parseFromString(html, 'text/html',)
	let changed = false
	doc.body.querySelectorAll('a',).forEach((anchor,) => {
		if (!anchor.querySelector('.toolbox-radio-group-inline, .toolbox-reason-select',)) { return }
		unwrapLink(anchor,)
		changed = true
	},)
	return changed ? doc.body.innerHTML : html
}

/**
 * Renders a removal reason text field to HTML.
 * The text is first normalized to token form (legacy limited-HTML configs are
 * up-converted on the fly), then split into segments: `{choice}` blocks become
 * radio groups, inline `{choice: ...}` tokens become inline radio groups inside
 * their paragraph, `{dropdown}` choices of either form become `<select>`s, `{input: ...}`/`{textarea: ...}` tokens become inline form
 * elements carried through the markdown render via the parser's element
 * whitelist, and everything else renders as markdown.
 * @param parser SnuOwnd parser instance.
 * @param text Reason text in token form or legacy HTML form (already decoded
 *   via `decodeHtmlAngleBrackets`).
 * @param idPrefix Stable prefix for id-less `{choice}` blocks (e.g. the reason's positional id).
 *   Each id-less choice gets `${idPrefix}-${n}` by its position, so its selection persists across
 *   reopens. Callers rendering a single reason in isolation (e.g. previews) can omit it.
 * @returns Rendered HTML with form controls in place of the interactive tokens.
 */
export function renderReasonHtml (
	parser: ReturnType<typeof getRemovalReasonParser>,
	text: string,
	idPrefix: string = DEFAULT_ANON_CHOICE_PREFIX,
): string {
	// Heal legacy-HTML text on the fly (a no-op for token-form text): any
	// `<select>` becomes an inline `{choice}` block, inputs/textareas inline tokens.
	const healed = htmlFieldsToTokens(text,)

	const parts: string[] = []
	// Markdown accumulated until the next choice block; inline field tokens are
	// embedded into it as whitelisted HTML so they stay inside their paragraph.
	let pending = ''
	// Rendered radio groups for the inline choices in `pending`, indexed by placeholder.
	const inlineChoices: string[] = []
	// Position of the next id-less choice within this reason, for a stable fallback id.
	let anonChoiceIndex = 0
	const flush = () => {
		if (!pending) { return }
		let html = parser.render(pending,)
		pending = ''
		if (inlineChoices.length > 0) {
			html = unwrapLinksAroundChoices(
				html.replace(
					inlineChoicePlaceholderRe,
					(_match, index: string,) => inlineChoices[Number(index,)] ?? '',
				),
			)
			inlineChoices.length = 0
		}
		parts.push(html,)
	}

	// The control for a choice or tick-box token, with the next stable fallback id.
	const renderControl = (token: InteractiveToken,) => {
		const anonId = `${idPrefix}-${anonChoiceIndex++}`
		if (isToggleKind(token.kind,)) { return toggleTokenToCheckboxGroup(parser, token, anonId,) }
		return token.dropdown
			? choiceTokenToDropdown(parser, token, anonId,)
			: choiceTokenToRadioGroup(parser, token, anonId,)
	}

	for (const segment of parseReasonSegments(healed,)) {
		if (segment.type === 'text') {
			pending += segment.text
		} else if (segment.token.kind === 'note') {
			// Rides through the markdown render like an inline choice, so it stays in its line.
			pending += `${inlineChoicePlaceholder}${inlineChoices.length}Q`
			inlineChoices.push(noteTokenToHtml(parser, segment.token,),)
		} else if (segment.token.options.length > 0 && segment.token.inline) {
			// SnuOwnd would escape the control's HTML, so a plain-word placeholder rides
			// through the markdown render in its place and is swapped for the group after.
			pending += `${inlineChoicePlaceholder}${inlineChoices.length}Q`
			inlineChoices.push(renderControl(segment.token,),)
		} else if (segment.token.options.length > 0) {
			// SnuOwnd HTML-escapes <select> even when whitelisted, so choices and tick
			// boxes are spliced in as pre-rendered groups between markdown chunks.
			flush()
			parts.push(renderControl(segment.token,),)
		} else {
			pending += tokenToLegacyHtml(segment.token,)
		}
	}
	flush()

	return parts.join('',)
}

/**
 * Reads the checkboxes inside a `.toolbox-check-group` back into the `encodeTicks` value
 * its hidden input carries.
 * @param input The `<input type="hidden">` inside the checkbox group wrapper.
 */
export function ticksFromCheckboxes (input: HTMLInputElement,): string {
	const wrapper = input.closest('.toolbox-check-group',)
	if (!wrapper) { return input.value }
	return encodeTicks(
		Array.from(wrapper.querySelectorAll<HTMLInputElement>('input[type="checkbox"]',), (box,) => box.checked,),
	)
}

/** The wording pieces for a block marker that will be sent as text (see `describeLiteralField`). */
export interface LiteralFieldDescription {
	/** What the field is, e.g. `pick-one {choice}`. */
	name: string
	/** Why it won't become a control, phrased to follow "A <name> field ...". */
	cause: string
	/** The fix, as an imperative with no trailing period, so callers can say where to make it. */
	fix: string
}

/**
 * Words the warning for a block marker no control will be rendered for. Each problem
 * gets its own wording: naming the wrong mistake is worse than saying nothing, since it
 * sends the moderator looking at the part of the reason that is already correct.
 * @param field The marker and problem `findLiteralFieldMarker` reported.
 */
export function describeLiteralField (field: LiteralField,): LiteralFieldDescription {
	const marker = `{${field.dropdown ? 'dropdown' : field.kind}}`
	const isChoice = field.kind === 'choice'
	const name = `${isChoice ? 'pick-one' : 'tick-box'} ${marker}`
	const list = isChoice ? 'option list' : '"- [ ]" checklist'
	switch (field.problem) {
		case 'inline':
			return {
				name,
				cause: 'shares its line with other text, so it will be sent as text - marker, list and all -',
				fix: `Put the ${marker} marker on a line of its own, with the ${list} directly below it`,
			}
		case 'no-options':
			return {
				name,
				cause: `has no ${list} below it, so it will be sent as text - marker and all -`,
				fix: `Put the ${list} directly below the ${marker} line`,
			}
		case 'wrong-list':
			return isChoice
				? {
					name,
					cause: 'is followed by "- [ ]" checklist items, which only {multi} and {highlight} take, so '
						+ 'it will be sent as text - marker and all -',
					fix: 'Drop the "[ ]" boxes for a pick-one list, or use {multi} or {highlight} for tick boxes',
				}
				: {
					name,
					cause: 'is followed by plain "- " items instead of "- [ ]" checklist items, so it will be '
						+ 'sent as text - marker and all -',
					fix: 'Start each item with "- [ ] " (or "- [x] " to start it ticked)',
				}
	}
}

/** Maps a reasonType setting's stored string value to the overlay's delivery type. */
export function settingToReasonType (s: string,): ReasonType {
	switch (s) {
		case 'reply_with_a_comment_to_the_item_that_is_removed':
			return 'reply'
		case 'send_as_pm_(personal_message)':
			return 'pm'
		case 'send_as_both_pm_and_reply':
			return 'both'
		case 'none_(this_only_works_when_a_logsub_has_been_set)':
			return 'none'
		default:
			return 'reply'
	}
}

/** Returns an old-reddit domain listing URL for a post domain, or `null` for self posts. */
export function getDomainLink (domain: string | undefined,) {
	if (!domain || domain.toLowerCase().startsWith('self.',)) { return null }
	return `https://old.reddit.com/domain/${domain}`
}

/** One selected reason's resolved body, for capturing the trainee's selection. */
export interface ComposedReasonPiece {
	/** Persistent `RemovalReason.id` (falls back to the positional id when absent). */
	id: string
	/** This reason's resolved body (override or token-substituted markdown). */
	text: string
	/** The reason's display title, if any. */
	title?: string
}

/** The combined message and flair data composed from the selected reasons. */
export interface ComposedReason {
	/** Concatenated reason markdown, with user input values substituted in. */
	reason: string
	/** Space-joined flair text from all selected reasons. */
	flairText: string
	/** Space-joined flair CSS classes from all selected reasons. */
	flairCSS: string
	/** Flair template ID from the last selected reason that has one. */
	flairTemplateID: string
	/** Per-reason resolved bodies in display order, for re-seeding the overlay later. */
	pieces: ComposedReasonPiece[]
	/**
	 * The selected reasons with required fields left unfilled, in display order; empty when
	 * the message may be sent. `positions` are control positions within the reason, in the
	 * order `getInputValues` returns the controls' values.
	 */
	unfilled: UnfilledReason[]
}

/** A selected reason with required fields left unfilled (see {@link ComposedReason}). */
export interface UnfilledReason {
	/** The rendered reason's positional id (the key of its content element). */
	id: string
	/** The reason's display title, if any. */
	title?: string
	/** Control positions of the unfilled required fields. */
	positions: number[]
}

/**
 * Composes the final reason markdown and flair values from the selected reasons,
 * in display order. Each interactive token is substituted with the corresponding
 * user-entered value - in the edited-override text as well as the original
 * markdown, since an edited reason still renders its controls; the tokens and the
 * rendered controls share the same document order, so the values map 1:1.
 * @param checkedOrdered Selected reasons in their current display order.
 * @param getOverride Returns the edited markdown override for a reason, if any.
 * @param getInputValues Returns the current user-input values inside a reason's
 *   rendered content, in document order (excluding individual radio inputs).
 */
export function composeReasonText (
	checkedOrdered: RenderedReason[],
	getOverride: (id: string,) => string | undefined,
	getInputValues: (id: string,) => string[],
): ComposedReason {
	let reason = ''
	let flairText = ''
	let flairCSS = ''
	let flairTemplateID = ''
	const pieces: ComposedReasonPiece[] = []
	const unfilled: UnfilledReason[] = []

	checkedOrdered.forEach((r,) => {
		const override = getOverride(r.id,)
		// This reason's resolved body: the inline-edit override, or the markdown with
		// the user's fill-in values substituted in document order. The non-override
		// markdown already carries a trailing `\n\n` (healed at render time), so the
		// concatenation spacing below is preserved exactly as before.
		let body: string
		const values = getInputValues(r.id,)
		const text = override !== undefined ? htmlFieldsToTokens(override,) : r.markdown
		const positions = findUnfilledRequired(text, values,)
		if (positions.length > 0) {
			unfilled.push({id: r.id, positions, ...(r.reason.title ? {title: r.reason.title,} : {}),},)
		}
		if (override !== undefined) {
			// An edited reason still renders its interactive controls, so its values are
			// substituted just like the non-override path. The draft is healed first because
			// the editor may have typed raw legacy HTML, which the overrideHtml render also
			// heals - both must parse the same text for tokens and controls to line up 1:1.
			body = substituteTokenValues(text, values,)
			reason += `${body}\n\n`
		} else {
			body = substituteTokenValues(text, values,)
			reason += body
		}
		// Capture the resolved body keyed by the persistent reason id, so Edit & Accept
		// can re-seed the overlay against the (possibly edited) current config.
		pieces.push({
			id: r.reason.id ?? r.id,
			text: body.trim(),
			...(r.reason.title ? {title: r.reason.title,} : {}),
		},)
		if (r.reason.flairText) { flairText += ` ${r.reason.flairText}` }
		if (r.reason.flairCSS) { flairCSS += ` ${r.reason.flairCSS}` }
		if (r.reason.flairTemplateID) { flairTemplateID = r.reason.flairTemplateID }
	},)

	return {reason, flairText, flairCSS, flairTemplateID, pieces, unfilled,}
}
