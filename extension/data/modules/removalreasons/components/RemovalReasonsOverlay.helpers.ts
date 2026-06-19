/**
 * Pure helpers for the removal-reasons overlay: wiki-text-to-UI rendering
 * (including the `{select:name}` -> radio-group pipeline), reason-text
 * composition, and small mapping utilities.
 *
 * Reason text is the schema v2 token form (`{input: ...}`, `{textarea: ...}`,
 * and `{select:name}` references into the reason's select definitions).
 * Legacy limited-HTML text is accepted too - it is up-converted to tokens
 * (extracting `<select>`s into definitions) before rendering - so unmigrated
 * `getfrom` targets and stale caches keep working. The rendered controls are
 * unchanged from the legacy pipeline, so existing configs display
 * identically.
 */

import {
	htmlFieldsToTokens,
	InteractiveToken,
	parseReasonSegments,
	SelectDefinition,
	substituteTokenValues,
	tokenToLegacyHtml,
} from '../../../util/wiki/schemas/shared/tokens'
import {getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import {RemovalReason,} from '../schema'

/** Counter for generating unique radio group `name` attributes across all rendered reason cards. */
let radioGroupCounter = 0

/** How the removal reason message will be delivered to the author. */
export type ReasonType = 'reply' | 'pm' | 'both' | 'none'

/** A removal reason with its pre-rendered markdown and HTML. */
export interface RenderedReason {
	/** Stable key used as the dnd-kit sort ID. */
	id: string
	reason: RemovalReason
	/** Raw markdown string with a trailing newline, healed to token form. */
	markdown: string
	/**
	 * The reason's select definitions merged with any extracted from legacy
	 * HTML during healing; resolves the `{select:name}` references in
	 * {@link markdown}.
	 */
	selects: SelectDefinition[]
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
export const banError = 'failed to issue ban'

/**
 * Renders a `{select}` token as a radio button group.
 * Each option string is both the inserted value and the visible label; labels
 * are rendered as markdown so options can contain links and emphasis. The
 * token's optional prompt is rendered as markdown above the choices.
 * A `<input type="hidden">` inside the wrapper tracks the selected value for the save logic.
 * @param parser SnuOwnd parser instance for rendering option markdown labels.
 * @param token The parsed select token.
 * @returns HTML string containing a `.toolbox-radio-group` div with a hidden input inside.
 */
export function selectTokenToRadioGroup (
	parser: ReturnType<typeof getRemovalReasonParser>,
	token: InteractiveToken,
): string {
	const doc = new DOMParser().parseFromString('', 'text/html',)

	const selectId = token.id || `toolbox-anon-select-${radioGroupCounter}`
	const groupName = `toolbox-rg-${selectId}-${radioGroupCounter++}`

	const wrapper = doc.createElement('div',)
	wrapper.className = 'toolbox-radio-group'

	if (token.placeholder) {
		const prompt = doc.createElement('div',)
		prompt.className = 'toolbox-radio-group-prompt'
		let promptHtml = parser.render(token.placeholder,).trim()
		promptHtml = promptHtml.replace(/^<p>([\s\S]+)<\/p>$/, '$1',)
		prompt.innerHTML = promptHtml || token.placeholder
		wrapper.appendChild(prompt,)
	}

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
		// Render option text as markdown; strip single outer block wrapper so content
		// sits inline with the radio button.
		let labelHtml = parser.render(option,).trim()
		labelHtml = labelHtml
			.replace(/^<(?:ul|ol)>\s*<li>([\s\S]+)<\/li>\s*<\/(?:ul|ol)>$/, '$1',)
			.replace(/^<p>([\s\S]+)<\/p>$/, '$1',)
		span.innerHTML = labelHtml || option

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
 * Renders a removal reason text field to HTML.
 * The text is first normalized to token form (legacy limited-HTML configs are
 * up-converted on the fly), then split into segments: `{select: ...}` tokens
 * become radio groups, `{input: ...}`/`{textarea: ...}` tokens become inline form
 * elements carried through the markdown render via the parser's element
 * whitelist, and everything else renders as markdown.
 * @param parser SnuOwnd parser instance.
 * @param text Reason text in token form or legacy HTML form (already decoded
 *   via `decodeHtmlAngleBrackets`).
 * @param selects The reason's select definitions, used to resolve
 *   `{select:name}` references; an unresolved reference renders literally.
 * @returns Rendered HTML with form controls in place of the interactive tokens.
 */
export function renderReasonHtml (
	parser: ReturnType<typeof getRemovalReasonParser>,
	text: string,
	selects?: SelectDefinition[],
): string {
	// Heal legacy-HTML text on the fly (a no-op for token-form text), resolving
	// references against the reason's definitions plus any just extracted.
	const {text: healed, selects: extracted,} = htmlFieldsToTokens(text, selects ?? [],)
	const resolved = [...selects ?? [], ...extracted,]

	const parts: string[] = []
	// Markdown accumulated until the next select token; inline field tokens are
	// embedded into it as whitelisted HTML so they stay inside their paragraph.
	let pending = ''
	const flush = () => {
		if (pending) {
			parts.push(parser.render(pending,),)
			pending = ''
		}
	}

	for (const segment of parseReasonSegments(healed, resolved,)) {
		if (segment.type === 'text') {
			pending += segment.text
		} else if (segment.token.kind === 'select') {
			// SnuOwnd HTML-escapes <select> even when whitelisted, so selects are
			// spliced in as pre-rendered radio groups between markdown chunks.
			flush()
			parts.push(selectTokenToRadioGroup(parser, segment.token,),)
		} else {
			pending += tokenToLegacyHtml(segment.token,)
		}
	}
	flush()

	return parts.join('',)
}

/**
 * Syncs radio button checked states inside a `.toolbox-radio-group` to match the
 * current value of the hidden input that tracks the selection.
 * @param input The `<input type="hidden">` inside the radio group wrapper.
 */
export function syncRadiosToHiddenInput (input: HTMLInputElement,) {
	const wrapper = input.closest('.toolbox-radio-group',)
	if (!wrapper) { return }
	wrapper.querySelectorAll<HTMLInputElement>('input[type="radio"]',).forEach((radio,) => {
		radio.checked = radio.value === input.value
	},)
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
}

/**
 * Composes the final reason markdown and flair values from the selected reasons,
 * in display order. For reasons without an edited override, each interactive
 * token in the markdown is substituted with the corresponding user-entered
 * value; the tokens and the rendered controls share the same document order,
 * so the values map 1:1.
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

	checkedOrdered.forEach((r,) => {
		const override = getOverride(r.id,)
		// This reason's resolved body: the inline-edit override, or the markdown with
		// the user's fill-in values substituted in document order. The non-override
		// markdown already carries a trailing `\n\n` (healed at render time), so the
		// concatenation spacing below is preserved exactly as before.
		let body: string
		if (override !== undefined) {
			body = override
			reason += `${override}\n\n`
		} else {
			body = substituteTokenValues(r.markdown, getInputValues(r.id,), r.selects,)
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

	return {reason, flairText, flairCSS, flairTemplateID, pieces,}
}
