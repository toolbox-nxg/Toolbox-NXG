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
 *
 * Inputs and textareas are inline: everything they need is in the token. A
 * choice is a block: the marker sits on its own line and the consecutive
 * markdown list items immediately below it are its options. It renders as a
 * radio group (pick one), so it's named "choice" rather than after the
 * dropdown `<select>` widget 6.x produced:
 *
 *     Which rule was broken?
 *
 *     {choice#rule}
 *     - Rule 1
 *     - Rule 2
 *
 *     ...normal body text after the blank line...
 *
 * A choice's options live inline in the text, like an input's placeholder -
 * there is no separate definition to reference. The optional `#id` (slug-safe,
 * `[\w-]+`) persists the chosen value between overlay opens and round-trips as
 * the `id` attribute of the legacy `<select>`. A marker with no list line below
 * it isn't a choice and renders literally, so a half-typed field fails visibly.
 *
 * Substitution tokens are always a bare `{word}` with no colon, so neither the
 * `kind:` prefix nor `{choice}` can collide with them; unknown brace content is
 * left untouched by both systems.
 *
 * This module is the only code that knows both representations: it parses token
 * text into segments for rendering, and converts between tokens and the legacy
 * HTML form for the classic (v1) wiki mirror. The v1 -> v2 up-convert rewrites
 * each legacy `<select>` into an inline `{choice}` block; the v2 -> v1
 * down-convert expands a `{choice}` block back into `<select>` HTML so 6.x can
 * read it. {@link inlineSelectDefinitions} migrates the older v2 shape (a
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
	{token: '{domain}', description: 'Domain the post links to',},
	{token: '{mod}', description: 'Username of the moderator sending the removal',},
	{token: '{body}', description: 'Body of the removed item, quoted as markdown (each line prefixed with "> ")',},
	{token: '{fullname}', description: 'Reddit fullname of the removed item (e.g. t3_abc123)',},
	{token: '{id}', description: 'Short id of the removed item',},
	{token: '{link}', description: 'URL the post links to',},
	{token: '{raw_body}', description: 'Body of the removed item without markdown quoting',},
	{token: '{uri_body}', description: 'URL-encoded body, for use inside markdown links',},
	{token: '{uri_title}', description: 'URL-encoded title, for use inside markdown links',},
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
export type InteractiveTokenKind = 'input' | 'textarea' | 'choice'

/** A parsed interactive token from removal reason text. */
export interface InteractiveToken {
	kind: InteractiveTokenKind
	/**
	 * Optional stable id, used to persist the entered/chosen value between
	 * overlay opens and preserved as the HTML `id` attribute on the classic
	 * mirror. Written as `{input#someid: ...}` for inputs/textareas and
	 * `{choice#someid}` for choices.
	 */
	id?: string
	/** Placeholder text for `input`/`textarea` tokens; always '' for `choice`. */
	placeholder: string
	/** The option texts for `choice` tokens; empty for the other kinds. */
	options: string[]
}

/** A piece of reason text: either literal text or an interactive token. */
export type ReasonSegment =
	| {type: 'text'; text: string}
	| {type: 'token'; token: InteractiveToken}

/**
 * Matches an inline interactive token (`{input...}` / `{textarea...}`). Groups:
 * 1 is the kind, 2 the optional id, 3 the placeholder content. Content cannot
 * contain `}` - serialization sanitizes braces out of user-facing text so every
 * serialized token re-parses.
 */
const INLINE_TOKEN_RE = /\{(input|textarea)(?:#([\w-]+))?\s*:([^}]*)\}/gi

/** Matches a choice marker line (`{choice}` or `{choice#id}`) on its own line; group 1 is the id. */
const CHOICE_MARKER_RE = /^[ \t]*\{choice(?:#([\w-]+))?\}[ \t]*\r?$/

/** Matches a markdown list item line; group 1 is the option text (trailing whitespace trimmed). */
const CHOICE_OPTION_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.+?)[ \t]*\r?$/

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
 * Builds a `{choice}` block: the marker line followed by one `- option` line per
 * option (each collapsed to a single line). No surrounding blank lines - callers
 * that splice it into running text add those.
 */
function choiceBlock (id: string | undefined, options: string[],): string {
	const marker = id ? `{choice#${id}}` : '{choice}'
	const lines = options.map((option,) => `- ${collapseToLine(option,)}`)
	return [marker, ...lines,].join('\n',)
}

/**
 * Serializes an interactive token back to its text form. A choice serializes to
 * its block (marker + option list); inputs/textareas to their inline token.
 * @param token The token to serialize.
 */
export function serializeToken (token: InteractiveToken,): string {
	if (token.kind === 'choice') {
		return choiceBlock(token.id, token.options,)
	}
	const idPart = token.id ? `#${token.id}` : ''
	return `{${token.kind}${idPart}: ${sanitizeSingleLine(token.placeholder,)}}`
}

/**
 * Splits reason text into literal-text and interactive-token segments, in
 * document order. Inline `{input}`/`{textarea}` tokens are matched anywhere; a
 * `{choice}` marker is recognized only on its own line and consumes the
 * consecutive markdown list lines immediately below it as its options (stopping
 * at the first blank or non-list line). A marker with no list line below it is
 * left as literal text, like any other unknown brace content.
 * @param text The reason text to parse.
 */
export function parseReasonSegments (text: string,): ReasonSegment[] {
	const segments: ReasonSegment[] = []
	let buffer = ''
	// Flush accumulated plain text, splitting out any inline input/textarea tokens.
	const flush = () => {
		if (!buffer) { return }
		let lastIndex = 0
		INLINE_TOKEN_RE.lastIndex = 0
		let match: RegExpExecArray | null
		// eslint-disable-next-line no-cond-assign
		while ((match = INLINE_TOKEN_RE.exec(buffer,)) !== null) {
			const [, kind, id, content,] = match
			if (match.index > lastIndex) {
				segments.push({type: 'text', text: buffer.slice(lastIndex, match.index,),},)
			}
			const token: InteractiveToken = {
				kind: kind!.toLowerCase() as InteractiveTokenKind,
				placeholder: collapseToLine(content!,),
				options: [],
			}
			if (id) { token.id = id }
			segments.push({type: 'token', token,},)
			lastIndex = match.index + match[0].length
		}
		if (lastIndex < buffer.length) {
			segments.push({type: 'text', text: buffer.slice(lastIndex,),},)
		}
		buffer = ''
	}

	let i = 0
	const n = text.length
	while (i < n) {
		const nl = text.indexOf('\n', i,)
		const lineEnd = nl === -1 ? n : nl
		const nextLineStart = nl === -1 ? n : nl + 1
		const marker = CHOICE_MARKER_RE.exec(text.slice(i, lineEnd,),)
		if (marker) {
			const options: string[] = []
			let scan = nextLineStart
			let optionsEnd = -1
			while (scan < n) {
				const nl2 = text.indexOf('\n', scan,)
				const le2 = nl2 === -1 ? n : nl2
				const optionMatch = CHOICE_OPTION_RE.exec(text.slice(scan, le2,),)
				if (!optionMatch) { break }
				options.push(optionMatch[1]!,)
				optionsEnd = le2
				scan = nl2 === -1 ? n : nl2 + 1
			}
			if (options.length > 0) {
				flush()
				const token: InteractiveToken = {kind: 'choice', placeholder: '', options,}
				if (marker[1]) { token.id = marker[1] }
				segments.push({type: 'token', token,},)
				// Exclude the last option line's trailing newline so it stays with the
				// following text segment - this keeps down-convert / up-convert exact.
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
 * Rewrites every `{choice}` block in the text to its canonical form: each block
 * separated from surrounding content by exactly one blank line, options on
 * single `- ` lines. Idempotent, so normalizing the NXG text and the
 * up-converted legacy mirror both land on the same string and config reconcile
 * sees no spurious difference. Text with no choice block is returned unchanged.
 * @param text The reason text to canonicalize.
 */
export function canonicalizeChoiceBlocks (text: string,): string {
	if (!text.includes('{choice',)) { return text }
	const segments = parseReasonSegments(text,)
	if (!segments.some((segment,) => segment.type === 'token' && segment.token.kind === 'choice')) {
		return text
	}
	let out = ''
	for (const segment of segments) {
		if (segment.type === 'text') {
			out += segment.text
		} else if (segment.token.kind === 'choice') {
			out += `\n\n${serializeToken(segment.token,)}\n\n`
		} else {
			out += serializeToken(segment.token,)
		}
	}
	// Collapse every blank-line gap (2+ newlines, plus any horizontal whitespace
	// hugging it) to a single blank line. Touching only 2+ newline runs leaves
	// single-newline markdown hard breaks intact, and the spaces around a
	// paragraph break are insignificant - so this just tidies the seams the
	// block splicing above left behind.
	return out.replace(/[ \t]*\n{2,}[ \t]*/g, '\n\n',).replace(/^\n+/, '',).replace(/\n+$/, '',)
}

/**
 * Replaces each interactive token in reason text with the corresponding
 * user-entered value, in document order. Used when composing the final removal
 * message; values map 1:1 to the rendered controls because the overlay renders
 * them in the same order.
 * @param text The token-form reason text.
 * @param values The entered values, in token order. Missing values become ''.
 */
export function substituteTokenValues (text: string, values: string[],): string {
	let index = 0
	return parseReasonSegments(text,)
		.map((segment,) => segment.type === 'text' ? segment.text : values[index++] ?? '')
		.join('',)
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
		const reference = new RegExp(`\\{select\\s*:\\s*${escapeRegExp(definition.name,)}\\s*\\}`, 'g',)
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
 * Converts one legacy `<select>...</select>` block to an inline `{choice}`
 * block. A slug-safe `id` attribute is kept as `{choice#id}`; anything else
 * drops to a bare `{choice}` (the options carry the content, so no id is
 * needed). A `label` attribute (the old prompt, written by the down-convert and
 * invisible in 6.x) becomes a markdown line above the marker.
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
function selectHtmlToChoiceBlock (selectHtml: string,): string {
	const openTag = selectHtml.match(/^<select\b[^>]*>/i,)?.[0] ?? ''
	const rawId = getAttr(openTag, 'id',)
	const id = rawId && SLUG_RE.test(rawId,) ? rawId : undefined
	const options: string[] = []
	const optionRe = /<option(\s[^>]*)?>([^]*?)(?=<option\b|<\/select\b|$)/gi
	let match: RegExpExecArray | null
	// eslint-disable-next-line no-cond-assign
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
	const prompt = getAttr(openTag, 'label',)
	const block = choiceBlock(id, options,)
	return prompt ? `${prompt}\n\n${block}` : block
}

/** Converts one legacy `<input>` or `<textarea>` tag to the equivalent token. */
function fieldHtmlToToken (html: string,): InteractiveToken {
	const kind: InteractiveTokenKind = /^<textarea/i.test(html,) ? 'textarea' : 'input'
	const openTag = html.match(/^<\w+\b[^>]*>/i,)?.[0] ?? html
	const id = getAttr(openTag, 'id',)
	// Placeholder comes from the attribute; legacy textareas occasionally
	// carried their hint as inner text instead.
	let placeholder = getAttr(openTag, 'placeholder',) ?? ''
	if (!placeholder && kind === 'textarea') {
		placeholder = html.replace(/^<textarea\b[^>]*>/i, '',).replace(/<\/textarea>$/i, '',).trim()
	}
	const token: InteractiveToken = {kind, placeholder, options: [],}
	if (id) { token.id = id }
	return token
}

/**
 * Up-converts legacy (schema v1) reason text to token form: `<input>` and
 * `<textarea>` elements become inline tokens, `<br>` becomes a paragraph break,
 * and each `<select>` becomes an inline `{choice}` block (spliced in between
 * blank lines so the block marker lands on its own line; the caller's
 * {@link canonicalizeChoiceBlocks} pass tidies the spacing).
 *
 * Token-form text passes through unchanged, so this is safe (and idempotent) to
 * apply to any reason text regardless of origin. The input must already have
 * entity-encoded angle brackets decoded (see {@link decodeHtmlAngleBrackets}).
 * @param text The reason text to up-convert.
 */
export function htmlFieldsToTokens (text: string,): string {
	return text.replace(LEGACY_HTML_RE, (matched,) => {
		if (/^<br/i.test(matched,)) { return '\n\n' }
		if (/^<select/i.test(matched,)) { return `\n\n${selectHtmlToChoiceBlock(matched,)}\n\n` }
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
	const idAttr = token.id ? ` id="${escapeAttr(token.id,)}"` : ''
	switch (token.kind) {
		case 'choice': {
			const options = token.options
				.map((option,) => `<option>${escapeOptionMarkdown(collapseToLine(option,),)}</option>`)
				.join('',)
			return `<select${idAttr}>${options}</select>`
		}
		case 'textarea': {
			const placeholder = token.placeholder ? ` placeholder="${escapeAttr(token.placeholder,)}"` : ''
			return `<textarea${idAttr}${placeholder}></textarea>`
		}
		case 'input': {
			const placeholder = token.placeholder ? ` placeholder="${escapeAttr(token.placeholder,)}"` : ''
			return `<input${idAttr}${placeholder}>`
		}
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
