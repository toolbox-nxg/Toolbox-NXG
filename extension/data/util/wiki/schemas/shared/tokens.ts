/**
 * Interactive form-field tokens for removal reason templates (config schema v2).
 *
 * Classic toolbox (schema v1 / 6.x) let mods embed a limited set of literal
 * HTML elements in removal reason text - `<input>`, `<textarea>`, and
 * `<select>` with `<option>`s - that the overlay turned into fill-in fields.
 * Schema v2 replaces that HTML with brace tokens, which don't collide with
 * reddit markdown and read naturally alongside the existing substitution
 * tokens (`{subreddit}`, `{author}`, ...):
 *
 * - `{input: placeholder text}` - a single-line text field
 * - `{textarea: placeholder text}` - a multi-line text field
 * - `{choice}` / `{choice#id}` followed by a markdown list - a pick-one field
 * - `{choice: a | b}` / `{choice#id: a | b}` - a pick-one field inside a line
 * - `{dropdown}` / `{dropdown: a | b}` - the same pick-one field, shown as a dropdown
 *
 * Inputs and textareas are inline: everything they need is in the token. A
 * choice comes in two forms. The inline form lists its options in the token,
 * separated by `|` (`\|` for a literal pipe), and sits inside running text -
 * mid-sentence or as a link's text - so the picked value lands exactly there.
 * The block form puts the marker on its own line and the consecutive
 * markdown list items below it are its options. It renders as a radio group
 * (pick one), so it's named "choice" rather than after the dropdown `<select>`
 * widget 6.x produced:
 *
 *     Which rule was broken?
 *
 *     {choice#rule}
 *     - Rule 1
 *     - Rule 2
 *
 *     ...normal body text after the blank line...
 *
 * `{dropdown}` is a choice in every respect - same forms, ids, required mark and
 * options - except that the overlay shows it as a dropdown instead of radio buttons,
 * which suits a long option list. It parses to a `choice` token with `dropdown` set,
 * so everything that handles a choice handles it too. A 6.x `<select>` was a dropdown,
 * so an unmarked `<select>` up-converts to `{dropdown}`. NXG marks what it writes to the
 * v1 mirror so the round trip keeps the style: a `{choice}` becomes a `<select>` with a
 * `data-tbx-choice` attribute (ignored by 6.x, which keeps it), and a `{dropdown}` one
 * with `data-tbx-dropdown`, which builds that read unmarked selects as `{choice}` need.
 * The one unmarked shape still read as a `{choice}` is the two-option select 6.x configs
 * used to fake a tick box, so {@link promoteLegacyToggles} can still turn it into one.
 *
 * The list may also be separated from the marker by blank lines, which is how
 * markdown lists are usually written; the block is canonicalized back to the
 * tight form above on save.
 *
 * A choice's options live inline in the text, like an input's placeholder -
 * there is no separate definition to reference. The optional `#id` (slug-safe,
 * `[\w-]+`) persists the chosen value between overlay opens and round-trips as
 * the `id` attribute of the legacy `<select>`. A marker whose next non-blank
 * line isn't a list item isn't a choice and renders literally, so a half-typed
 * field fails visibly; {@link findLiteralFieldMarker} finds those so the
 * moderator is told rather than the marker reaching the removed user.
 *
 * Tick-box fields have no 6.x counterpart. They use the same block shape with a
 * GFM task list for options, and render as checkboxes (pick any number):
 *
 * - `{multi}` / `{multi#id}` followed by `- [ ] item` lines - only the ticked
 *   items are sent, as a `- ` list
 * - `{highlight}` / `{highlight#id}` followed by `- [ ] item` lines - every
 *   item is sent as a `- ` list, the ticked ones in bold
 * - `{check: text}` / `{highlight: text}` - one tick box inside a line: `check`
 *   sends the text only when ticked, `highlight` always sends it, bolded when
 *   ticked
 *
 * `[x]` instead of `[ ]` (`{check: [x] text}` inline) starts the box ticked. A
 * tick-box marker takes only task-list items and a `{choice}` marker only plain
 * ones, so a list of the wrong style leaves the marker literal (and flagged)
 * rather than turning into the other kind of control. Both down-convert to one
 * 6.x `<select>` per item, offering the item's two possible outputs, and
 * {@link promoteLegacyToggles} turns that two-option pattern (or the same
 * pattern hand-written as a `{choice}`) back into the tick-box token.
 *
 * Two more pieces of syntax apply across the kinds:
 *
 * - `{note: text}` - guidance for the moderator, shown in the overlay and never sent.
 *   It renders no control, so it takes no value slot.
 * - `!` after the kind or id (`{input!: ...}`, `{choice#rule!}`, `{multi!}`) marks a
 *   field required: the overlay won't send until it is filled, picked (a non-blank
 *   option), or ticked ({@link findUnfilledRequired}).
 *
 * On the v1 mirror a note becomes an empty `<input>` with a reserved id and the note
 * as its placeholder, and `!` becomes a `required` attribute; both read back exactly.
 *
 * Substitution tokens are always a bare `{word}` with no colon, so neither the
 * `kind:` prefix nor the bare block markers can collide with them; unknown brace
 * content is left untouched by both systems.
 *
 * This module is the only code that knows both representations: it parses token
 * text into segments for rendering, and converts between tokens and the legacy
 * HTML form for the classic (v1) wiki mirror. The v1 -> v2 up-convert rewrites
 * each legacy `<select>` into a `{dropdown}` (or `{choice}`, see above) block when it
 * had a line to itself, or into an inline token when it shared its line with text;
 * the v2 -> v1 down-convert expands either form back into `<select>` HTML in
 * place so 6.x can read it. {@link inlineSelectDefinitions} migrates the older v2 shape (a
 * `{select:name}` reference into a separate definition) into the inline form.
 */

/**
 * Decodes HTML-entity-encoded angle brackets so `&lt;select&gt;` configs are treated
 * the same as configs that store literal `<select>` tags.
 * Handles any number of `&amp;` prefixes (e.g. `&amp;amp;amp;lt;`) so configs that
 * were entity-encoded multiple times by old toolbox or Reddit's API round-trips
 * are recovered correctly.
 * Safe for surrounding markdown: SnuOwnd re-encodes any `<`/`>` it sees, so the
 * display output is identical whether we pre-decode or not.
 */
export function decodeHtmlAngleBrackets (text: string,): string {
	return text
		.replace(/&(?:amp;)*lt;/g, '<',)
		.replace(/&(?:amp;)*gt;/g, '>',)
}

/** A substitution token (`{author}`, `{url}`, ...) with a human-readable description for editor UIs. */
export interface SubstitutionTokenInfo {
	/** The literal token text including braces, e.g. `{author}`. */
	token: string
	/** What the token expands to, phrased for a tooltip in the settings editor. */
	description: string
}

/**
 * The substitution tokens the removal overlay replaces with context data, in
 * the order editor UIs should offer them (common tokens first). Descriptions
 * match the values built in `util/reddit/thingInfo.ts` and consumed by the
 * overlay's token source.
 */
export const substitutionTokens: SubstitutionTokenInfo[] = [
	{token: '{author}', description: 'Username of the post/comment author',},
	{token: '{subreddit}', description: 'Name of the subreddit',},
	{token: '{kind}', description: '"submission" or "comment", whichever was removed',},
	{token: '{title}', description: 'Title of the post',},
	{token: '{url}', description: 'Permalink to the removed post or comment',},
	{token: '{permalink}', description: 'Same as {url}: permalink to the post or comment',},
	{token: '{domain}', description: 'Domain the post links to',},
	{token: '{mod}', description: 'Username of the moderator sending the removal',},
	{token: '{body}', description: 'Body of the removed item, quoted as markdown (each line prefixed with "> ")',},
	{token: '{fullname}', description: 'Reddit fullname of the removed item (e.g. t3_abc123)',},
	{token: '{id}', description: 'Short id of the removed item',},
	{token: '{link}', description: 'URL the post links to',},
	{token: '{raw_body}', description: 'Body of the removed item without markdown quoting',},
	{token: '{uri_body}', description: 'URL-encoded body, for use inside markdown links',},
	{token: '{uri_title}', description: 'URL-encoded title, for use inside markdown links',},
	{token: '{modmail}', description: 'Link for sending modmail to the subreddit\'s moderators',},
	{token: '{wiki: page}', description: 'Link to a page on the subreddit\'s wiki; add #anchor for a section',},
]

/**
 * Picks a context-specific subset of {@link substitutionTokens} by token text,
 * preserving the master list's order. Editor UIs use this to offer only the
 * tokens their context actually substitutes.
 * @param tokens Token texts including braces, e.g. `'{author}'`.
 */
export function pickSubstitutionTokens (tokens: string[],): SubstitutionTokenInfo[] {
	return substitutionTokens.filter(({token,},) => tokens.includes(token,))
}

/** The kinds of interactive fill-in fields supported in reason text. */
export type InteractiveTokenKind = 'input' | 'textarea' | 'choice' | 'multi' | 'highlight' | 'note'

/** The field kinds that have a block form: a marker line with a list below it. */
export type BlockFieldKind = 'choice' | 'multi' | 'highlight'

/**
 * The tick-box kinds. `multi` sends only the ticked items; `highlight` sends every
 * item and bolds the ticked ones. Inline, `multi` is written `{check: ...}`.
 */
export type ToggleKind = 'multi' | 'highlight'

/** Whether a token kind is one of the tick-box kinds. */
export function isToggleKind (kind: InteractiveTokenKind,): kind is ToggleKind {
	return kind === 'multi' || kind === 'highlight'
}

/** A parsed interactive token from removal reason text. */
export interface InteractiveToken {
	kind: InteractiveTokenKind
	/**
	 * Optional stable id, used to persist the entered/chosen value between
	 * overlay opens and preserved as the HTML `id` attribute on the classic
	 * mirror. Written as `{input#someid: ...}` for inputs/textareas and
	 * `{choice#someid}` / `{multi#someid}` for the block kinds.
	 */
	id?: string
	/**
	 * Placeholder text for `input`/`textarea` tokens, or the moderator-facing text of a
	 * `note`; always '' for the other kinds.
	 */
	placeholder: string
	/**
	 * The option texts for `choice` tokens, or the item texts for tick-box tokens
	 * (exactly one when inline); empty for the other kinds.
	 */
	options: string[]
	/**
	 * Per-item starting state for tick-box tokens (`[x]` in the text), parallel to
	 * `options`; absent for the other kinds.
	 */
	checked?: boolean[]
	/**
	 * Set when the field is marked required (`!` after the kind or id: `{input!: ...}`,
	 * `{choice#rule!}`). The overlay refuses to send until it is filled, picked, or ticked.
	 * Never set on a `note`.
	 */
	required?: true
	/**
	 * Set on a `choice` or tick box written in its inline form (`{choice: a | b}`,
	 * `{check: text}`, `{highlight: text}`). The value is substituted in place in its
	 * line rather than as a block of its own.
	 */
	inline?: true
	/**
	 * Set on a `choice` written as `{dropdown}`: the overlay shows it as a dropdown rather
	 * than radio buttons. Nothing else about the choice changes.
	 */
	dropdown?: true
}

/** A piece of reason text: either literal text or an interactive token. */
export type ReasonSegment =
	| {type: 'text'; text: string}
	| {type: 'token'; token: InteractiveToken}

/**
 * Matches an inline interactive token (`{input...}` / `{textarea...}` / `{choice...: ...}` /
 * `{check...: ...}` / `{highlight...: ...}` / `{note: ...}`). Groups: 1 is the keyword, 2 the
 * optional id, 3 the optional required `!`, 4 the content (placeholder, the `|`-separated
 * options of a choice, a tick box's text, or a note's text).
 * Content cannot contain `}` - serialization sanitizes braces out of user-facing text so
 * every serialized token re-parses.
 */
const INLINE_TOKEN_RE = /\{(input|textarea|choice|dropdown|check|highlight|note)(?:#([\w-]+))?(!)?\s*:([^}]*)\}/gi

/**
 * Matches the optional leading tick box of inline tick-box content (`[x] text`); group 1
 * is the box's mark. A link written as the text (`[x](url)`) has no space after the `]`,
 * so it is not mistaken for one; a box with nothing after it still counts, so a
 * half-typed `{check: [x]}` stays literal rather than becoming a box labelled "[x]".
 */
const INLINE_TICK_RE = /^\[([ xX])\](?:[^\S\r\n]+|$)/

/** Cheap pre-check: whether text could hold any choice or tick-box field at all. */
const FIELD_HINT_RE = /\{(?:choice|dropdown|multi|highlight|check)/i

/** Splits on a `|` that is not backslash-escaped. */
const OPTION_SEPARATOR_RE = /(?<!\\)\|/

/**
 * Splits inline choice content into its options, unescaping `\|`. Returns an
 * empty list when no option has any text, so a half-typed `{choice:}` stays
 * literal and fails visibly instead of sending nothing.
 */
function splitInlineOptions (content: string,): string[] {
	const options = collapseToLine(content,)
		.split(OPTION_SEPARATOR_RE,)
		.map((option,) => option.replace(/\\\|/g, '|',).trim())
	return options.some((option,) => option !== '') ? options : []
}

/** Escapes an option for inline choice content: braces become parens, `|` becomes `\|`. */
function escapeInlineOption (option: string,): string {
	return sanitizeSingleLine(option,).replace(/\\?\|/g, '\\|',)
}

/**
 * Matches a block marker line (`{choice}`, `{multi#id}`, `{highlight}`, ...) on its own
 * line; group 1 is the kind, group 2 the id, group 3 the required `!`. The whitespace class is every horizontal
 * space rather than just space/tab, so a non-breaking space pasted in from a rich-text
 * editor doesn't quietly stop the line being a marker.
 */
const BLOCK_MARKER_RE = /^[^\S\r\n]*\{(choice|dropdown|multi|highlight)(?:#([\w-]+))?(!)?\}[^\S\r\n]*\r?$/

/**
 * Matches a markdown list item line; group 1 is the option text (trailing whitespace
 * trimmed), or undefined for a bullet with no text. The text is optional so a blank
 * option - the classic 6.x "nothing picked yet" placeholder `<option></option>` -
 * survives as an empty option instead of ending the block. Both `- ` and a bare `-`
 * parse to '', because canonicalization strips the trailing space of a blank option
 * that sits last in a block. A bullet glued to its text (`-word`) still fails.
 */
const CHOICE_OPTION_RE = /^[^\S\r\n]*(?:[-*+]|\d+[.)])(?:[^\S\r\n]+(.+?))?[^\S\r\n]*\r?$/

/**
 * Matches a GFM task-list item line (`- [ ] text`, `- [x] text`); group 1 is the box's
 * mark, group 2 the item text. Unlike a choice option the text is required: an empty
 * tick box would send nothing either way.
 */
const TASK_ITEM_RE = /^[^\S\r\n]*(?:[-*+]|\d+[.)])[^\S\r\n]+\[([ xX])\][^\S\r\n]+(.+?)[^\S\r\n]*\r?$/

/** Matches a line with nothing on it but horizontal whitespace. */
const BLANK_LINE_RE = /^[^\S\r\n]*\r?$/

/** Matches a block marker anywhere in a line, for spotting one that did not become a token. */
const BLOCK_MARKER_ANYWHERE_RE = /\{(choice|dropdown|multi|highlight)(?:#[\w-]+)?!?\}/

/** The block kind a marker keyword stands for: `dropdown` is a `choice` shown as a dropdown. */
function blockKindOf (keyword: string,): BlockFieldKind {
	return keyword === 'dropdown' ? 'choice' : keyword as BlockFieldKind
}

/**
 * Whether a line is a list item of the style the given block kind takes: task-list
 * items for the tick-box kinds, plain items for `{choice}`. A task item ends a choice's
 * list rather than becoming an option with `[ ]` in its text.
 */
function isBlockItem (kind: BlockFieldKind, line: string,): boolean {
	if (kind === 'choice') { return CHOICE_OPTION_RE.test(line,) && !TASK_ITEM_RE.test(line,) }
	return TASK_ITEM_RE.test(line,)
}

/** Matches a whole slug-safe id/name. */
const SLUG_RE = /^[\w-]+$/

/** Escapes a string for safe literal use inside a RegExp. */
function escapeRegExp (value: string,): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&',)
}

/** Collapses a multi-line string to a single trimmed line (options/placeholders are single-line). */
function collapseToLine (text: string,): string {
	return text.replace(/\s*\r?\n\s*/g, ' ',).trim()
}

/**
 * Removes characters from one-line token content (placeholders) that would
 * break the token syntax: braces become parens and line breaks collapse to
 * spaces.
 */
function sanitizeSingleLine (text: string,): string {
	return collapseToLine(text.replace(/\{/g, '(',).replace(/\}/g, ')',),)
}

/**
 * Builds a block field: the marker line followed by one list line per option (each
 * collapsed to a single line) - `- option` for a choice, `- [ ] item` / `- [x] item`
 * for a tick-box kind. No surrounding blank lines - callers that splice it into
 * running text add those.
 */
function fieldBlock (
	kind: BlockFieldKind | 'dropdown',
	id: string | undefined,
	options: string[],
	checked?: boolean[],
	required?: boolean,
): string {
	const marker = `{${kind}${id ? `#${id}` : ''}${required ? '!' : ''}}`
	const lines = options.map((option, index,) => {
		const box = kind === 'choice' || kind === 'dropdown' ? '' : `${checked?.[index] ? '[x]' : '[ ]'} `
		return `- ${box}${collapseToLine(option,)}`
	},)
	return [marker, ...lines,].join('\n',)
}

/** Builds a `{choice}` block from its id and options. */
function choiceBlock (id: string | undefined, options: string[],): string {
	return fieldBlock('choice', id, options,)
}

/**
 * Serializes an inline tick box. The `[ ]` of an unticked box is left out, as it
 * usually is when written by hand, unless the text itself starts with something
 * that would re-parse as a box.
 */
function inlineToggleText (token: InteractiveToken, idPart: string,): string {
	const keyword = token.kind === 'multi' ? 'check' : 'highlight'
	const text = sanitizeSingleLine(token.options[0] ?? '',)
	const box = token.checked?.[0] ? '[x] ' : INLINE_TICK_RE.test(text,) ? '[ ] ' : ''
	return `{${keyword}${idPart}: ${box}${text}}`
}

/**
 * Serializes an interactive token back to its text form. A choice or tick-box block
 * serializes to its block (marker + list); everything else to its inline token.
 * @param token The token to serialize.
 */
export function serializeToken (token: InteractiveToken,): string {
	// The id and the required mark sit together between the kind and the colon.
	const idPart = `${token.id ? `#${token.id}` : ''}${token.required ? '!' : ''}`
	if (token.kind === 'choice') {
		const keyword = token.dropdown ? 'dropdown' : 'choice'
		if (token.inline) {
			return `{${keyword}${idPart}: ${token.options.map(escapeInlineOption,).join(' | ',)}}`
		}
		return fieldBlock(keyword, token.id, token.options, undefined, token.required,)
	}
	if (isToggleKind(token.kind,)) {
		if (token.inline) { return inlineToggleText(token, idPart,) }
		return fieldBlock(token.kind, token.id, token.options, token.checked, token.required,)
	}
	return `{${token.kind}${idPart}: ${sanitizeSingleLine(token.placeholder,)}}`
}

/**
 * Parses the content of an inline tick box (`[x] text`, or just `text`) into a token,
 * or `null` when there is no text - a half-typed `{check:}` stays literal.
 */
function parseInlineToggle (kind: ToggleKind, content: string,): InteractiveToken | null {
	const collapsed = collapseToLine(content,)
	const tick = INLINE_TICK_RE.exec(collapsed,)
	const text = tick ? collapsed.slice(tick[0].length,).trim() : collapsed
	if (!text) { return null }
	return {kind, placeholder: '', options: [text,], checked: [tick !== null && tick[1] !== ' ',], inline: true,}
}

/** A parsed segment together with the exact source text it was parsed from. */
interface SourcedSegment {
	segment: ReasonSegment
	source: string
}

/**
 * Splits reason text into literal-text and interactive-token segments, in
 * document order. Inline `{input}`/`{textarea}`/`{choice: ...}`/`{check: ...}`/
 * `{highlight: ...}` tokens are matched anywhere; a block marker (`{choice}`,
 * `{multi}`, `{highlight}`) is recognized only on its own line and consumes the
 * consecutive markdown list lines of its style below it as its options, skipping
 * any blank lines between the two and stopping at the first line that is not
 * such an item. A marker whose next non-blank line is not an item of its style is
 * left as literal text, like any other unknown brace content.
 * @param text The reason text to parse.
 */
export function parseReasonSegments (text: string,): ReasonSegment[] {
	return parseSourcedSegments(text,).map(({segment,},) => segment)
}

/**
 * {@link parseReasonSegments}, keeping each segment's source text so a caller can
 * rewrite some tokens and leave the rest of the text byte-for-byte as written.
 */
function parseSourcedSegments (text: string,): SourcedSegment[] {
	const segments: SourcedSegment[] = []
	const pushText = (chunk: string,) => segments.push({segment: {type: 'text', text: chunk,}, source: chunk,},)
	let buffer = ''
	// Flush accumulated plain text, splitting out any inline tokens.
	const flush = () => {
		if (!buffer) { return }
		let lastIndex = 0
		INLINE_TOKEN_RE.lastIndex = 0
		let match: RegExpExecArray | null

		while ((match = INLINE_TOKEN_RE.exec(buffer,)) !== null) {
			const [, keyword, id, bang, content,] = match
			const lowerKeyword = keyword!.toLowerCase()
			let token: InteractiveToken | null
			if (lowerKeyword === 'choice' || lowerKeyword === 'dropdown') {
				const options = splitInlineOptions(content!,)
				token = options.length > 0 ? {kind: 'choice', placeholder: '', options, inline: true,} : null
				if (token && lowerKeyword === 'dropdown') { token.dropdown = true }
			} else if (lowerKeyword === 'check' || lowerKeyword === 'highlight') {
				token = parseInlineToggle(lowerKeyword === 'check' ? 'multi' : 'highlight', content!,)
			} else if (lowerKeyword === 'note') {
				const text = collapseToLine(content!,)
				token = text ? {kind: 'note', placeholder: text, options: [],} : null
			} else {
				token = {
					kind: lowerKeyword as InteractiveTokenKind,
					placeholder: collapseToLine(content!,),
					options: [],
				}
			}
			// Nothing to offer: leave it in the surrounding text, where it is sent literally.
			if (!token) { continue }
			if (match.index > lastIndex) { pushText(buffer.slice(lastIndex, match.index,),) }
			if (id) { token.id = id }
			// A note is never filled in, so there is nothing for "required" to require.
			if (bang && token.kind !== 'note') { token.required = true }
			segments.push({segment: {type: 'token', token,}, source: match[0],},)
			lastIndex = match.index + match[0].length
		}
		if (lastIndex < buffer.length) { pushText(buffer.slice(lastIndex,),) }
		buffer = ''
	}

	let i = 0
	const n = text.length
	while (i < n) {
		const nl = text.indexOf('\n', i,)
		const lineEnd = nl === -1 ? n : nl
		const nextLineStart = nl === -1 ? n : nl + 1
		const marker = BLOCK_MARKER_RE.exec(text.slice(i, lineEnd,),)
		if (marker) {
			const kind = blockKindOf(marker[1]!,)
			const options: string[] = []
			const checked: boolean[] = []
			let scan = nextLineStart
			let optionsEnd = -1
			// Step over any blank lines between the marker and its list: that is how markdown
			// lists are normally written, and treating it as "not a choice" sent the marker and
			// every option to the removed user instead of the one the moderator picked. Only
			// committed if a list actually follows, so an unrelated marker still stays literal.
			while (scan < n) {
				const blankEnd = text.indexOf('\n', scan,)
				if (!BLANK_LINE_RE.test(text.slice(scan, blankEnd === -1 ? n : blankEnd,),)) { break }
				if (blankEnd === -1) {
					scan = n
					break
				}
				scan = blankEnd + 1
			}
			while (scan < n) {
				const nl2 = text.indexOf('\n', scan,)
				const le2 = nl2 === -1 ? n : nl2
				const line = text.slice(scan, le2,)
				if (!isBlockItem(kind, line,)) { break }
				if (kind === 'choice') {
					options.push(CHOICE_OPTION_RE.exec(line,)![1] ?? '',)
				} else {
					const item = TASK_ITEM_RE.exec(line,)!
					checked.push(item[1] !== ' ',)
					options.push(item[2]!,)
				}
				optionsEnd = le2
				scan = nl2 === -1 ? n : nl2 + 1
			}
			if (options.length > 0) {
				flush()
				const token: InteractiveToken = kind === 'choice'
					? {kind, placeholder: '', options,}
					: {kind, placeholder: '', options, checked,}
				if (marker[1] === 'dropdown') { token.dropdown = true }
				if (marker[2]) { token.id = marker[2] }
				if (marker[3]) { token.required = true }
				// Exclude the last option line's trailing newline so it stays with the
				// following text segment - this keeps down-convert / up-convert exact.
				segments.push({segment: {type: 'token', token,}, source: text.slice(i, optionsEnd,),},)
				i = optionsEnd
				continue
			}
		}
		buffer += text.slice(i, nextLineStart,)
		i = nextLineStart
	}
	flush()
	return segments
}

/**
 * Why a block marker will be sent as text instead of becoming a control. The shapes
 * need different fixes, so callers can word their warning for the one at hand.
 */
export type LiteralFieldProblem =
	/** The marker shares its line with other text, so it never starts a block at all. */
	| 'inline'
	/** The marker has a line to itself, but no list follows it. */
	| 'no-options'
	/**
	 * The marker is followed by a list of the other style: plain `- ` items under a
	 * tick-box marker, or `- [ ]` task items under `{choice}`.
	 */
	| 'wrong-list'

/** A block marker no control will be rendered for: which kind it is, and why. */
export interface LiteralField {
	kind: BlockFieldKind
	problem: LiteralFieldProblem
	/** Set when the marker was written `{dropdown}`, so a warning can quote it as written. */
	dropdown?: true
}

/**
 * Finds the first block marker (`{choice}`, `{multi}`, `{highlight}`) in the text that
 * no control will be rendered for - a half-typed field, one written inline in a
 * sentence, or one given the wrong style of list - and reports which. Returns `null`
 * when every marker in the text becomes a control.
 *
 * Such a marker is not substituted, so the marker text and the list below it both
 * reach the removed user as written. That is the right default for unknown brace
 * content, but a field failing this way is a mistake every time, so callers surface it
 * to the moderator instead of leaving it to be discovered in a sent message.
 * @param text The reason text to check, already normalized to token form.
 */
export function findLiteralFieldMarker (text: string,): LiteralField | null {
	if (!FIELD_HINT_RE.test(text,)) { return null }
	// Applies the same marker/blank/list rule as parseReasonSegments (and off the same
	// regexes), but line-by-line rather than over segments: a segment boundary can fall
	// mid-line where an inline token sits next to a marker, and the line is what decides
	// which problem this is.
	const lines = text.split('\n',)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		const anywhere = BLOCK_MARKER_ANYWHERE_RE.exec(line,)
		if (!anywhere) { continue }
		const kind = blockKindOf(anywhere[1]!,)
		const report = (problem: LiteralFieldProblem,): LiteralField =>
			anywhere[1] === 'dropdown' ? {kind, problem, dropdown: true,} : {kind, problem,}
		// A marker with other text on its line never starts a block, whatever follows it,
		// so it has to move to a line of its own before a list can help.
		if (!BLOCK_MARKER_RE.test(line,)) { return report('inline',) }
		let scan = i + 1
		while (scan < lines.length && BLANK_LINE_RE.test(lines[scan]!,)) { scan++ }
		const first = lines[scan]
		if (first === undefined) { return report('no-options',) }
		if (!isBlockItem(kind, first,)) {
			const otherStyle = kind === 'choice' ? TASK_ITEM_RE.test(first,) : CHOICE_OPTION_RE.test(first,)
			return report(otherStyle ? 'wrong-list' : 'no-options',)
		}
		// A real block: step over its list, so an item whose own text mentions a marker
		// isn't read as a second, broken one.
		while (scan < lines.length && isBlockItem(kind, lines[scan]!,)) { scan++ }
		i = scan - 1
	}
	return null
}

/**
 * Rewrites every block field (`{choice}`, `{multi}`, `{highlight}`) in the text to its
 * canonical form: each block separated from surrounding content by exactly one blank
 * line, items on single `- ` (or `- [ ] `) lines. Inline tokens stay where they are,
 * re-serialized (`a | b` option spacing, `[x]` only on a ticked box). Idempotent, so
 * normalizing the NXG text and the up-converted legacy mirror both land on the same
 * string and config reconcile sees no spurious difference. Text with no such field
 * is returned unchanged.
 * @param text The reason text to canonicalize.
 */
export function canonicalizeChoiceBlocks (text: string,): string {
	if (!FIELD_HINT_RE.test(text,)) { return text }
	const segments = parseReasonSegments(text,)
	if (!segments.some((segment,) => segment.type === 'token' && segment.token.options.length > 0)) {
		return text
	}
	let out = ''
	for (const segment of segments) {
		if (segment.type === 'text') {
			out += segment.text
		} else if (segment.token.options.length > 0 && !segment.token.inline) {
			out += `\n\n${serializeToken(segment.token,)}\n\n`
		} else {
			// Inline tokens (including inline choices and tick boxes) re-serialize in place,
			// which also normalizes an inline choice's option spacing and escaping.
			out += serializeToken(segment.token,)
		}
	}
	// Collapse every blank-line gap (a run of empty or whitespace-only lines, plus any
	// trailing whitespace before it) to a single blank line, tidying the seams the block
	// splicing above left behind. Touching only runs of 2+ newlines leaves single-newline
	// markdown hard breaks intact. The indentation of the line after the gap is kept: it
	// is significant in markdown (it makes a paragraph or sub-list part of the list item
	// above, or a code block), and stripping it broke indented list continuations.
	return out.replace(/[ \t]*\n(?:[ \t]*\n)+/g, '\n\n',).replace(/^\n+/, '',).replace(/\n+$/, '',)
}

/**
 * Rewrites every inline `{choice: ...}` token as a `{choice}` block on lines of
 * its own, then canonicalizes - reproducing how builds before the inline form
 * stored a legacy `<select>` that sat mid-sentence. Used only to recognise
 * reason text those builds split, so it can be restored (see
 * `recoverSplitChoiceTexts` in `wikiMigration.ts`). Text with no inline choice
 * is returned unchanged.
 * @param text Token-form reason text.
 */
export function splitInlineChoices (text: string,): string {
	const segments = parseReasonSegments(text,)
	const isInlineChoice = (token: InteractiveToken,) => token.kind === 'choice' && token.inline
	if (!segments.some((segment,) => segment.type === 'token' && isInlineChoice(segment.token,))) { return text }
	return canonicalizeChoiceBlocks(
		segments.map((segment,) => {
			if (segment.type === 'text') { return segment.text }
			if (!isInlineChoice(segment.token,)) { return serializeToken(segment.token,) }
			// Those builds had no dropdowns, so a select read back as one was split as a `{choice}`.
			const {inline: _inline, dropdown: _dropdown, ...block} = segment.token
			return `\n\n${serializeToken(block,)}\n\n`
		},).join('',),
	)
}

/**
 * Rewrites every `{dropdown` keyword as `{choice`, for comparisons that should not see
 * the pick style. A v1 mirror written before selects carried a style mark reads back
 * with dropdowns where the NXG page has choices, and that difference is not a 6.x edit.
 * The result is for comparing only; it is never stored.
 * @param text Token-form reason text.
 */
export function ignorePickStyle (text: string,): string {
	return text.replace(/\{dropdown(?=[#!:}\s])/gi, '{choice',)
}

/**
 * Whether the text holds a `{choice}` block - the only shape an earlier build
 * could have split out of a sentence.
 * @param text Token-form reason text.
 */
export function hasChoiceBlock (text: string,): boolean {
	if (!text.includes('{choice',)) { return false }
	return parseReasonSegments(text,).some((segment,) =>
		segment.type === 'token' && segment.token.kind === 'choice' && !segment.token.inline
	)
}

/**
 * Bolds text for a ticked `highlight` item. Text that already holds `**` is wrapped in
 * `__` instead, so the new emphasis can't pair up with the existing markers.
 */
export function emphasize (text: string,): string {
	return text.includes('**',) ? `__${text}__` : `**${text}**`
}

/**
 * Encodes a tick-box control's state as the value its overlay control carries: the
 * indices of the ticked items, comma-separated ('' when none is ticked).
 */
export function encodeTicks (ticks: readonly boolean[],): string {
	return ticks.flatMap((ticked, index,) => ticked ? [String(index,),] : []).join(',',)
}

/**
 * Decodes a value written by {@link encodeTicks} into one flag per item. Anything that
 * isn't an in-range index is ignored, so a stale value (say a cached `{choice}` pick
 * from before the field became a tick box) reads as nothing ticked.
 */
export function decodeTicks (value: string, count: number,): boolean[] {
	const ticked = new Set(
		value.split(',',).map((part,) => part.trim()).filter((part,) => /^\d+$/.test(part,)).map(Number,),
	)
	return Array.from({length: count,}, (_, index,) => ticked.has(index,),)
}

/**
 * Renders the markdown a tick-box token sends for the given tick state. A block sends
 * a `- ` list (`multi`: the ticked items only; `highlight`: every item, ticked ones in
 * bold); an inline box sends its text (`multi`: only when ticked; `highlight`: always,
 * bolded when ticked). A `multi` block with nothing ticked sends nothing.
 * @param token A `multi` or `highlight` token.
 * @param ticks One flag per item; missing flags count as unticked.
 */
export function renderToggleValue (token: InteractiveToken, ticks: readonly boolean[],): string {
	const pieces = token.options.flatMap((option, index,) => {
		const ticked = ticks[index] ?? false
		if (token.kind === 'highlight') { return [ticked ? emphasize(option,) : option,] }
		return ticked ? [option,] : []
	},)
	if (token.inline) { return pieces[0] ?? '' }
	return pieces.map((piece,) => `- ${piece}`).join('\n',)
}

/**
 * Replaces each interactive token in reason text with the corresponding
 * user-entered value, in document order. Used when composing the final removal
 * message; values map 1:1 to the rendered controls because the overlay renders
 * them in the same order. A tick-box token's value is its {@link encodeTicks}
 * state, which is rendered to markdown here. A `{note}` is dropped and takes no value,
 * since the overlay renders no control for it.
 * @param text The token-form reason text.
 * @param values The entered values, in token order. A missing value becomes '', or
 *   the template's starting ticks for a tick-box token.
 */
export function substituteTokenValues (text: string, values: string[],): string {
	let index = 0
	return parseReasonSegments(text,)
		.map((segment,) => {
			if (segment.type === 'text') { return segment.text }
			// A note is for the moderator only: it renders no control and sends nothing.
			if (segment.token.kind === 'note') { return '' }
			const value = values[index++]
			const {token,} = segment
			if (!isToggleKind(token.kind,)) { return value ?? '' }
			const ticks = value === undefined ? token.checked ?? [] : decodeTicks(value, token.options.length,)
			return renderToggleValue(token, ticks,)
		},)
		.join('',)
}

/**
 * Finds the required fields left unfilled, given the values collected from their
 * controls (in the same order {@link substituteTokenValues} takes them). An input or
 * textarea needs non-blank text, a choice a non-blank pick (so a blank first option
 * works as "nothing picked yet"), and a tick-box field at least one tick.
 * @param text The token-form reason text.
 * @param values The entered values, in control order. A missing value counts as the
 *   template's starting state.
 * @returns The value indices (control positions) of the unfilled required fields.
 */
export function findUnfilledRequired (text: string, values: string[],): number[] {
	const unfilled: number[] = []
	let index = 0
	for (const segment of parseReasonSegments(text,)) {
		if (segment.type === 'text' || segment.token.kind === 'note') { continue }
		const {token,} = segment
		const position = index++
		if (!token.required) { continue }
		const value = values[position]
		let filled: boolean
		if (isToggleKind(token.kind,)) {
			const ticks = value === undefined ? token.checked ?? [] : decodeTicks(value, token.options.length,)
			filled = ticks.some(Boolean,)
		} else if (token.kind === 'choice') {
			filled = (value ?? token.options[0] ?? '').trim() !== ''
		} else {
			filled = (value ?? '').trim() !== ''
		}
		if (!filled) { unfilled.push(position,) }
	}
	return unfilled
}

/**
 * The two options of the 6.x `<select>` (or inline `{choice}`) equivalent to one
 * tick-box item: the unticked output and the ticked one, with whichever the box starts
 * as listed first, since the first option is what 6.x and the overlay start on.
 */
function toggleChoiceOptions (kind: ToggleKind, text: string, ticked: boolean,): [string, string,] {
	const off = kind === 'highlight' ? text : ''
	const on = kind === 'highlight' ? emphasize(text,) : text
	return ticked ? [on, off,] : [off, on,]
}

/**
 * Recognizes an inline choice that is really a tick box - two options where one is
 * the other in bold (`a | **a**`) or one is empty (` | a`) - and returns the tick-box
 * token it stands for, or `null`. The option listed first decides the starting tick.
 */
function toggleFromChoice (token: InteractiveToken,): InteractiveToken | null {
	// A dropdown was chosen as one on purpose, so it is never read as a disguised tick box.
	if (token.kind !== 'choice' || token.dropdown || !token.inline || token.options.length !== 2) { return null }
	const [first, second,] = token.options.map((option,) => option.trim()) as [string, string,]
	let toggle: InteractiveToken | null = null
	const make = (kind: ToggleKind, text: string, ticked: boolean,): InteractiveToken => ({
		kind,
		placeholder: '',
		options: [text,],
		checked: [ticked,],
		inline: true,
	})
	if (first && second === emphasize(first,)) { toggle = make('highlight', first, false,) }
	else if (second && first === emphasize(second,)) { toggle = make('highlight', second, true,) }
	else if (!first && second) { toggle = make('multi', second, false,) }
	else if (first && !second) { toggle = make('multi', first, true,) }
	if (toggle && token.id) { toggle.id = token.id }
	if (toggle && token.required) { toggle.required = true }
	return toggle
}

/**
 * Rewrites every inline `{choice}` that is really a tick box (see `toggleFromChoice`)
 * as the tick-box token: `{choice: a | **a**}` becomes `{highlight: a}` and
 * `{choice: | a}` becomes `{check: a}`, with `[x]` when the ticked output was listed
 * first. This is the pattern 6.x configs used to fake highlighting with one `<select>`
 * per line, and the shape tick boxes down-convert to on the v1 mirror, so it both
 * migrates those configs and brings a mirror round trip back to tick boxes. Only the
 * matching tokens change; every other byte of the text is kept as written.
 * @param text Token-form reason text.
 */
export function promoteLegacyToggles (text: string,): string {
	if (!/\{choice/i.test(text,)) { return text }
	let changed = false
	const out = parseSourcedSegments(text,).map(({segment, source,},) => {
		if (segment.type === 'text') { return source }
		const toggle = toggleFromChoice(segment.token,)
		if (!toggle) { return source }
		changed = true
		return serializeToken(toggle,)
	},)
	return changed ? out.join('',) : text
}

/**
 * The reverse of {@link promoteLegacyToggles}: rewrites every tick-box token as the
 * inline `{choice}` (or, for a block, one `- {choice: ...}` line per item) it would
 * have been before promotion, keeping every other byte of the text as written. Used
 * to recognise historical text that an earlier build split apart (see
 * `recoverSplitChoiceTexts` in `wikiMigration.ts`), since that build saw the choices.
 * @param text Token-form reason text.
 */
export function demoteToggles (text: string,): string {
	if (!FIELD_HINT_RE.test(text,)) { return text }
	return parseSourcedSegments(text,).map(({segment, source,},) => {
		if (segment.type === 'text' || !isToggleKind(segment.token.kind,)) { return source }
		const {token,} = segment
		const kind = token.kind as ToggleKind
		const choices = token.options.map((option, index,) => {
			const choice: InteractiveToken = {
				kind: 'choice',
				placeholder: '',
				options: toggleChoiceOptions(kind, collapseToLine(option,), token.checked?.[index] ?? false,),
				inline: true,
			}
			if (token.inline && token.id) { choice.id = token.id }
			if (token.inline && token.required) { choice.required = true }
			return serializeToken(choice,)
		},)
		return token.inline ? choices[0] ?? '' : choices.map((choice,) => `- ${choice}`).join('\n',)
	},).join('',)
}

/**
 * A legacy `<select>` definition the older v2 schema stored separately and
 * referenced from text as `{select:name}`. Only used by
 * {@link inlineSelectDefinitions} to migrate such configs to the inline form.
 */
export interface LegacySelectDefinition {
	name: string
	prompt?: string
	options: string[]
}

/**
 * Migrates the older v2 shape - a `{select:name}` reference resolving to a
 * separate definition - into the inline `{choice}` form. Each reference is
 * replaced by a block built from its definition: the prompt (if any) as a
 * markdown line above the marker, and the options as a list below it. A
 * reference whose definition is missing or empty is left untouched (it renders
 * literally). Idempotent: text with no `{select:name}` references is unchanged.
 * @param text The reason text containing `{select:name}` references.
 * @param selects The reason's legacy select definitions.
 */
export function inlineSelectDefinitions (text: string, selects: LegacySelectDefinition[],): string {
	let out = text
	for (const definition of selects) {
		if (!definition || typeof definition.name !== 'string' || definition.name === '') { continue }
		const options = Array.isArray(definition.options,)
			? definition.options.filter((option,): option is string => typeof option === 'string')
			: []
		if (options.length === 0) { continue }
		const id = SLUG_RE.test(definition.name,) ? definition.name : undefined
		const block = choiceBlock(id, options,)
		const withPrompt = definition.prompt ? `${definition.prompt}\n\n${block}` : block
		// The spaces either side of the reference separated it from the sentence it sat in;
		// once the block is on lines of its own they would only dangle at the cut, so they
		// are consumed with the reference.
		const reference = new RegExp(`[ \\t]*\\{select\\s*:\\s*${escapeRegExp(definition.name,)}\\s*\\}[ \\t]*`, 'g',)
		out = out.replace(reference, `\n\n${withPrompt}\n\n`,)
	}
	return out
}

// --- Legacy HTML conversion ------------------------------------------------

/** Matches the legacy HTML form elements (and `<br>`) that v1 reason text may contain. */
const LEGACY_HTML_RE =
	/<br\s*\/?>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>|<textarea\b[^>]*\/?>|<input\b[^>]*\/?>/gi

/** Extracts an attribute value from a single HTML tag string, entity-decoding quotes. */
function getAttr (tag: string, name: string,): string | undefined {
	const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i',),)
	if (!match) { return undefined }
	const value = match[2] ?? match[3] ?? match[4] ?? ''
	return value.replace(/&quot;/g, '"',).replace(/&amp;/g, '&',)
}

/**
 * The attribute that marks a `<select>` on the v1 mirror as a `{dropdown}`. An unmarked
 * select reads as one anyway; the mark is kept for builds that read unmarked selects as
 * `{choice}`. 6.x ignores it but keeps it, as it does `required`; it is written with a
 * value because SnuOwnd drops valueless attributes.
 */
const legacyDropdownAttr = 'data-tbx-dropdown'

/**
 * The attribute that marks a `<select>` on the v1 mirror as a `{choice}` (radio buttons)
 * rather than the dropdown an unmarked 6.x select reads as. Kept by 6.x like
 * {@link legacyDropdownAttr}.
 */
const legacyChoiceAttr = 'data-tbx-choice'

/** A legacy `<select>` parsed into a choice token, plus its `label` prompt if it had one. */
interface ParsedLegacySelect {
	token: InteractiveToken
	prompt?: string
	/** Set when the select carried neither style mark, so its style is still to be decided. */
	unmarked?: true
}

/**
 * Parses one legacy `<select>...</select>` element into a `{choice}` token. A
 * slug-safe `id` attribute is kept as `{choice#id}`; anything else drops to a
 * bare `{choice}` (the options carry the content, so no id is needed). A
 * `label` attribute (the old prompt, written by the down-convert and invisible
 * in 6.x) is returned separately for the block form to place above the marker.
 *
 * Mirrors the quirks the old radio-group renderer handled: a `)` directly after
 * `</option>` belongs to a markdown link inside the option (with the `\)`
 * escape that protected it stripped), and an explicit `value` attribute wins
 * over the option text because the value is what the legacy pipeline inserted
 * into the removal message. Backslash escapes before `[`, `]`, `(`, and `)` are
 * stripped: 6.x ran the whole reason through markdown before extracting the
 * select, so mods escaped link syntax inside options; token-form options aren't
 * markdown-mangled, so the clean `[text](url)` renders as a real link.
 *
 * Option text runs to the next `<option>` or `</select>` rather than requiring a
 * well-formed `</option>` closer: real v1 configs contain hand-typed closers
 * like `</optiom>`, which 6.x's DOM-based parser silently forgave.
 */
function parseLegacySelect (selectHtml: string,): ParsedLegacySelect {
	const openTag = selectHtml.match(/^<select\b[^>]*>/i,)?.[0] ?? ''
	const rawId = getAttr(openTag, 'id',)
	const id = rawId && SLUG_RE.test(rawId,) ? rawId : undefined
	const options: string[] = []
	const optionRe = /<option(\s[^>]*)?>([^]*?)(?=<option\b|<\/select\b|$)/gi
	let match: RegExpExecArray | null

	while ((match = optionRe.exec(selectHtml,)) !== null) {
		const attrs = match[1] ?? ''
		// Strip the (possibly misspelled) closing tag, keeping a markdown link's `)`.
		const text = match[2]!
			.replace(/<\/[a-z][\w-]*\s*>(\))?\s*$/i, '$1',)
			.replace(/\\\)\)/g, ')',)
			.replace(/\\([[\]()])/g, '$1',)
		const value = getAttr(`<option${attrs}>`, 'value',)
		options.push(value !== undefined ? value : text,)
	}
	const token: InteractiveToken = {kind: 'choice', placeholder: '', options,}
	if (id) { token.id = id }
	if (hasBooleanAttr(openTag, 'required',)) { token.required = true }
	if (hasBooleanAttr(openTag, legacyDropdownAttr,)) { token.dropdown = true }
	const prompt = getAttr(openTag, 'label',)
	const parsed: ParsedLegacySelect = prompt ? {token, prompt,} : {token,}
	if (!token.dropdown && !hasBooleanAttr(openTag, legacyChoiceAttr,)) { parsed.unmarked = true }
	return parsed
}

/**
 * Matches what may share a line with a `<select>` that still counts as having the
 * line to itself: whitespace, `<br>`, and other `<select>` elements (6.x configs
 * often put several selects back to back with nothing else on the line).
 */
const SELECT_LINE_FILLER_RE = /<br\s*\/?>|<select\b[^>]*>[\s\S]*?<\/select>|\s+/gi

/**
 * Whether the `<select>` at `start`..`end` of `text` shares its line with other
 * content, i.e. was written mid-sentence (or as a link's text) rather than on a
 * line of its own.
 */
function isSelectInline (text: string, start: number, end: number,): boolean {
	const lineStart = text.lastIndexOf('\n', start - 1,) + 1
	const nextNewline = text.indexOf('\n', end,)
	const lineEnd = nextNewline === -1 ? text.length : nextNewline
	const rest = text.slice(lineStart, start,) + text.slice(end, lineEnd,)
	return rest.replace(SELECT_LINE_FILLER_RE, '',) !== ''
}

/**
 * Converts one legacy `<select>...</select>` element to its token form. A select
 * that shared its line with text becomes an inline token spliced in place, so the
 * picked value lands mid-sentence just as 6.x inserted it; one on a line of its own
 * becomes a block between blank lines, its `label` prompt (if any) as a markdown line
 * above the marker. An unmarked select becomes a `{dropdown}`, as 6.x showed it,
 * unless it is an inline faked tick box, which stays a `{choice}` for
 * {@link promoteLegacyToggles} to promote.
 */
function selectHtmlToTokenText (selectHtml: string, inline: boolean,): string {
	const {token, prompt, unmarked,} = parseLegacySelect(selectHtml,)
	if (unmarked && !(inline && toggleFromChoice({...token, inline: true,},))) { token.dropdown = true }
	if (inline) {
		// The prompt was never visible in 6.x and has no place inside a sentence.
		return serializeToken({...token, inline: true,},)
	}
	const block = serializeToken(token,)
	return `\n\n${prompt ? `${prompt}\n\n${block}` : block}\n\n`
}

/**
 * The `id` a `{note}` is written out with on the v1 mirror. 6.x has no notes, so a note
 * becomes an empty `<input>` whose placeholder is the note: 6.x moderators see it and,
 * left empty as intended, it sends nothing there either. The id is how the up-convert
 * tells it apart from a real fill-in field.
 */
const legacyNoteId = 'tbx-note'

/**
 * Converts one legacy `<input>` or `<textarea>` tag to the equivalent token. An `<input>`
 * carrying the {@link legacyNoteId} is a `{note}` written out for the mirror.
 */
function fieldHtmlToToken (html: string,): InteractiveToken {
	const kind: InteractiveTokenKind = /^<textarea/i.test(html,) ? 'textarea' : 'input'
	const openTag = html.match(/^<\w+\b[^>]*>/i,)?.[0] ?? html
	const id = getAttr(openTag, 'id',)
	if (kind === 'input' && id === legacyNoteId) {
		return {kind: 'note', placeholder: getAttr(openTag, 'placeholder',) ?? '', options: [],}
	}
	// Placeholder comes from the attribute; legacy textareas occasionally
	// carried their hint as inner text instead.
	let placeholder = getAttr(openTag, 'placeholder',) ?? ''
	if (!placeholder && kind === 'textarea') {
		placeholder = html.replace(/^<textarea\b[^>]*>/i, '',).replace(/<\/textarea>$/i, '',).trim()
	}
	const token: InteractiveToken = {kind, placeholder, options: [],}
	if (id) { token.id = id }
	if (hasBooleanAttr(openTag, 'required',)) { token.required = true }
	return token
}

/**
 * Up-converts legacy (schema v1) reason text to token form: `<input>` and
 * `<textarea>` elements become inline tokens, `<br>` becomes a paragraph break,
 * and each `<select>` becomes a `{dropdown}` or `{choice}` (see
 * {@link selectHtmlToTokenText}): an inline token when
 * the select shared its line with text, otherwise a block spliced in between
 * blank lines so the marker lands on its own line (the caller's
 * {@link canonicalizeChoiceBlocks} pass tidies the spacing).
 *
 * Token-form text passes through unchanged, so this is safe (and idempotent) to
 * apply to any reason text regardless of origin. The input must already have
 * entity-encoded angle brackets decoded (see {@link decodeHtmlAngleBrackets}).
 * @param text The reason text to up-convert.
 */
export function htmlFieldsToTokens (text: string,): string {
	return text.replace(LEGACY_HTML_RE, (matched, offset: number,) => {
		if (/^<br/i.test(matched,)) { return '\n\n' }
		if (/^<select/i.test(matched,)) {
			return selectHtmlToTokenText(matched, isSelectInline(text, offset, offset + matched.length,),)
		}
		return serializeToken(fieldHtmlToToken(matched,),)
	},)
}

/**
 * Up-converts only the inline legacy fields - `<input>`, `<textarea>`, and
 * `<br>` - leaving any `<select>` HTML untouched. Used for the removal message
 * header and footer, which display no interactive choice controls.
 * @param text The header/footer text to up-convert.
 */
export function htmlSimpleFieldsToTokens (text: string,): string {
	return text.replace(LEGACY_HTML_RE, (matched,) => {
		if (/^<br/i.test(matched,)) { return '\n\n' }
		if (/^<select/i.test(matched,)) { return matched }
		return serializeToken(fieldHtmlToToken(matched,),)
	},)
}

/** Whether an HTML open tag carries the given boolean attribute (`required`, `required=""`, ...). */
function hasBooleanAttr (tag: string, name: string,): boolean {
	return new RegExp(`\\s${name}(?=[\\s=/>])`, 'i',).test(tag,)
}

/** Escapes a string for use inside a double-quoted HTML attribute. */
function escapeAttr (value: string,): string {
	return value.replace(/&/g, '&amp;',).replace(/"/g, '&quot;',)
}

/**
 * Backslash-escapes `[`, `]`, and `(` in option text for the legacy mirror.
 * 6.x runs the whole reason through markdown before extracting the select, so
 * unescaped link syntax inside an option would be turned into an anchor and
 * break the option text; the escapes render as the literal characters there.
 * A close parenthesis needs no escape - with the opening characters escaped a
 * lone `)` can't form link syntax, and escaping it leaves a stray backslash
 * visible in 6.x. Already-escaped characters are normalized rather than
 * double-escaped (including stripping a `\)`, which the up-convert would remove
 * anyway), and the up-convert strips these escapes again on the way back.
 */
function escapeOptionMarkdown (text: string,): string {
	return text
		.replace(/\\?([[\](])/g, '\\$1',)
		.replace(/\\\)/g, ')',)
}

/**
 * Serializes an interactive token to the legacy HTML element 6.x understands.
 * A choice's id becomes the `<select>` `id` attribute; its options become
 * `<option>`s with markdown link characters backslash-escaped to survive 6.x's
 * markdown pass. The choice's prompt is plain text above the block, not part of
 * the token, so no `label` attribute is written.
 */
export function tokenToLegacyHtml (token: InteractiveToken,): string {
	// 6.x ignores `required`, but the attribute survives its rewrites, so a required field
	// comes back required. It is written with a value because SnuOwnd, which renders the
	// overlay's inline fields, drops valueless attributes.
	const idAttr = (token.id ? ` id="${escapeAttr(token.id,)}"` : '') + (token.required ? ' required="required"' : '')
	const selectHtml = (attr: string, options: readonly string[],) =>
		`<select${attr}>${
			options.map((option,) => `<option>${escapeOptionMarkdown(collapseToLine(option,),)}</option>`).join('',)
		}</select>`
	const choiceAttr = ` ${legacyChoiceAttr}="1"`
	switch (token.kind) {
		case 'choice':
			return selectHtml(`${idAttr} ${token.dropdown ? legacyDropdownAttr : legacyChoiceAttr}="1"`, token.options,)
		case 'multi':
		case 'highlight': {
			// 6.x has no tick box, so each item becomes a `<select>` offering its two
			// possible outputs - the pattern promoteLegacyToggles reads back. A block's
			// items are `- ` list lines, as the overlay sends them; its id names the whole
			// block, so (like 6.x itself, with no way to share one) the selects go without -
			// and without its required mark, which per item would demand the wrong thing.
			const kind = token.kind
			const selects = token.options.map((option, index,) =>
				selectHtml(
					(token.inline ? idAttr : '') + choiceAttr,
					toggleChoiceOptions(kind, collapseToLine(option,), token.checked?.[index] ?? false,),
				)
			)
			return token.inline ? selects[0] ?? '' : selects.map((select,) => `- ${select}`).join('\n',)
		}
		case 'textarea': {
			const placeholder = token.placeholder ? ` placeholder="${escapeAttr(token.placeholder,)}"` : ''
			return `<textarea${idAttr}${placeholder}></textarea>`
		}
		case 'input': {
			const placeholder = token.placeholder ? ` placeholder="${escapeAttr(token.placeholder,)}"` : ''
			return `<input${idAttr}${placeholder}>`
		}
		case 'note':
			return `<input id="${legacyNoteId}" placeholder="${escapeAttr(token.placeholder,)}">`
	}
}

/**
 * Down-converts token-form reason text to the legacy HTML form for the classic
 * (schema v1) wiki mirror: inline tokens become HTML form elements and each
 * `{choice}` block becomes a `<select>` element. Literal text - including
 * paragraph breaks, which 6.x handles fine as newlines - passes through
 * unchanged.
 * @param text The token-form reason text.
 */
export function tokensToHtmlFields (text: string,): string {
	return parseReasonSegments(text,)
		.map((segment,) => segment.type === 'text' ? segment.text : tokenToLegacyHtml(segment.token,))
		.join('',)
}
