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
 * - `{select:name}` - a pick-one choice, referencing a named definition
 *
 * Unlike inputs and textareas, a select's choices are not written inline in
 * the text. They live in a {@link SelectDefinition} stored alongside the
 * reason (`RemovalReason.selects`), built in the reason editor's select
 * builder, and the text carries only the compact `{select:name}` reference.
 * A reference whose name matches no definition is left in the text untouched
 * - it renders literally and is never substituted, so a typo'd or deleted
 * name fails visibly instead of silently dropping content.
 *
 * Input/textarea tokens may carry an optional stable id
 * (`{input#flightnum: Flight number}`) used to persist the entered value
 * between overlay opens; for selects the definition name plays that role.
 * Both round-trip to the `id` attribute of the legacy HTML form for 6.x.
 *
 * Substitution tokens are always a bare `{word}` with no colon, so the
 * `kind:` prefix here can never collide with them; unknown brace content is
 * left untouched by both systems.
 *
 * This module is the only code that knows both representations: it parses
 * token text into segments for rendering, and converts between tokens and
 * the legacy HTML form for the classic (v1) wiki mirror. The v1 -> v2
 * up-convert extracts each legacy `<select>` into a definition and leaves a
 * reference behind; the v2 -> v1 down-convert expands references back into
 * full `<select>` HTML using the reason's definitions.
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

/**
 * A named pick-one choice defined on a removal reason and referenced from its
 * text as `{select:name}`. Built in the reason editor's select builder and
 * stored on `RemovalReason.selects`; expanded to a legacy `<select>` element
 * on the classic v1 wiki mirror.
 */
export interface SelectDefinition {
	/**
	 * Slug-safe name (`[\w-]+`), unique within the reason. Doubles as the
	 * stable id for persisting the chosen value between overlay opens and
	 * round-trips as the `id` attribute on the legacy mirror.
	 */
	name: string
	/**
	 * Optional prompt rendered above the choices. Round-trips as the legacy
	 * `label` attribute. Omitted (never `''`) when empty so the wiki JSON and
	 * legacy-reconcile equality checks stay stable.
	 */
	prompt?: string
	/** Choice texts; each is both the visible (markdown) label and the inserted value. */
	options: string[]
}

/** The kinds of interactive fill-in fields supported in reason text. */
export type InteractiveTokenKind = 'input' | 'textarea' | 'select'

/** A parsed interactive token from removal reason text. */
export interface InteractiveToken {
	kind: InteractiveTokenKind
	/**
	 * Optional stable id (`{input#someid: ...}`) for input/textarea tokens, used
	 * to persist entered values between overlay opens and preserved as the
	 * HTML `id` attribute on the classic mirror. For select tokens this is the
	 * definition name and is always present on a resolved token.
	 */
	id?: string
	/**
	 * Placeholder text for `input`/`textarea` tokens. For `select` tokens this
	 * is the definition's prompt shown above the choices ('' when none).
	 */
	placeholder: string
	/** The choice texts for `select` tokens; empty for the other kinds. */
	options: string[]
}

/** A piece of reason text: either literal text or an interactive token. */
export type ReasonSegment =
	| {type: 'text'; text: string}
	| {type: 'token'; token: InteractiveToken}

/**
 * Matches any interactive token. Groups: 1-3 are an input/textarea's kind,
 * id, and content; 4 is a select reference's definition name. Input/textarea
 * content cannot contain `}` - serialization sanitizes braces out of
 * user-facing text so every serialized token re-parses.
 */
const TOKEN_START_RE = /\{(input|textarea)(?:#([\w-]+))?\s*:([^}]*)\}|\{select\s*:\s*([\w-]+)\s*\}/gi

/** Matches a whole valid select definition name. */
const SELECT_NAME_RE = /^[\w-]+$/

/**
 * Removes characters from one-line token content (placeholders) that would
 * break the token syntax: braces become parens and line breaks collapse to
 * spaces.
 */
function sanitizeSingleLine (text: string,): string {
	return text
		.replace(/\{/g, '(',)
		.replace(/\}/g, ')',)
		.replace(/\s*\r?\n\s*/g, ' ',)
		.trim()
}

/**
 * Serializes an interactive token back to its text form. A select serializes
 * to its `{select:name}` reference - the options live in the definition, not
 * the text - so the token must carry its definition name in `id`.
 * @param token The token to serialize.
 */
export function serializeToken (token: InteractiveToken,): string {
	if (token.kind === 'select') {
		return `{select:${token.id ?? ''}}`
	}
	const idPart = token.id ? `#${token.id}` : ''
	return `{${token.kind}${idPart}: ${sanitizeSingleLine(token.placeholder,)}}`
}

/**
 * Splits reason text into literal-text and interactive-token segments, in
 * document order. A `{select:name}` reference resolves against the given
 * definitions; one that matches no definition stays in the surrounding text
 * untouched, like any other unknown brace content (substitution tokens such
 * as `{subreddit}` likewise pass through in the text segments).
 * @param text The reason text to parse.
 * @param selects The reason's select definitions, used to resolve references.
 */
export function parseReasonSegments (text: string, selects?: SelectDefinition[],): ReasonSegment[] {
	const segments: ReasonSegment[] = []
	let lastIndex = 0
	TOKEN_START_RE.lastIndex = 0
	let match: RegExpExecArray | null
	// eslint-disable-next-line no-cond-assign
	while ((match = TOKEN_START_RE.exec(text,)) !== null) {
		const [, fieldKind, fieldId, fieldContent, selectName,] = match
		let token: InteractiveToken

		if (fieldKind !== undefined) {
			token = {
				kind: fieldKind.toLowerCase() as InteractiveTokenKind,
				placeholder: fieldContent!.replace(/\s*\r?\n\s*/g, ' ',).trim(),
				options: [],
			}
			if (fieldId) { token.id = fieldId }
		} else {
			const definition = selects?.find((d,) => d.name === selectName)
			if (!definition) {
				// Unresolved reference: leave it in the running text. lastIndex is
				// not advanced, so the literal token lands in the next text segment.
				continue
			}
			token = {
				kind: 'select',
				id: definition.name,
				placeholder: definition.prompt ?? '',
				options: definition.options,
			}
		}

		if (match.index > lastIndex) {
			segments.push({type: 'text', text: text.slice(lastIndex, match.index,),},)
		}
		segments.push({type: 'token', token,},)
		lastIndex = match.index + match[0].length
	}
	if (lastIndex < text.length) {
		segments.push({type: 'text', text: text.slice(lastIndex,),},)
	}
	return segments
}

/**
 * Replaces each interactive token in reason text with the corresponding
 * user-entered value, in document order. Used when composing the final
 * removal message; values map 1:1 to the rendered controls because the
 * overlay renders them in the same order, resolving references against the
 * same definitions. An unresolved `{select:name}` is a text segment and is
 * never substituted away.
 * @param text The token-form reason text.
 * @param values The entered values, in token order. Missing values become ''.
 * @param selects The reason's select definitions, used to resolve references.
 */
export function substituteTokenValues (
	text: string,
	values: string[],
	selects?: SelectDefinition[],
): string {
	let index = 0
	return parseReasonSegments(text, selects,)
		.map((segment,) => segment.type === 'text' ? segment.text : values[index++] ?? '')
		.join('',)
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
 * Converts one legacy `<select>...</select>` block to a select definition (the
 * name is settled later by the caller, which knows which names are taken).
 * Mirrors the quirks the old radio-group renderer handled: a `)` directly
 * after `</option>` belongs to a markdown link inside the option (with the
 * `\)` escape that protected it stripped), and an explicit `value` attribute
 * wins over the option text because the value is what the legacy pipeline
 * inserted into the removal message. A `label` attribute (written by the
 * down-convert for select prompts; ignored visually by 6.x) becomes the
 * prompt again.
 *
 * Backslash escapes before `[`, `]`, `(`, and `)` are stripped from option
 * text: 6.x ran the whole reason through markdown before extracting the
 * select, so mods had to escape link syntax inside options to keep it from
 * being eaten. Token-form options aren't markdown-mangled, so the clean
 * `[text](url)` renders as a real link in the overlay. The down-convert
 * re-adds the escapes for `[`, `]`, and `(` (see `escapeOptionMarkdown`; `)`
 * needs none), so v1 mirrors round-trip.
 *
 * Option text runs to the next `<option>` or `</select>` rather than
 * requiring a well-formed `</option>` closer: real v1 configs contain
 * hand-typed closers like `</optiom>`, which 6.x's DOM-based parser silently
 * forgave - requiring the exact closer here would merge adjacent options.
 */
function selectHtmlToDefinition (selectHtml: string,): {id?: string} & Omit<SelectDefinition, 'name'> {
	const openTag = selectHtml.match(/^<select\b[^>]*>/i,)?.[0] ?? ''
	const id = getAttr(openTag, 'id',)
	const options: string[] = []
	const optionRe = /<option(\s[^>]*)?>([^]*?)(?=<option\b|<\/select\b|$)/gi
	let match: RegExpExecArray | null
	// eslint-disable-next-line no-cond-assign
	while ((match = optionRe.exec(selectHtml,)) !== null) {
		const attrs = match[1] ?? ''
		// Strip the (possibly misspelled) closing tag, keeping a markdown
		// link's `)` that directly follows it.
		const text = match[2]!
			.replace(/<\/[a-z][\w-]*\s*>(\))?\s*$/i, '$1',)
			.replace(/\\\)\)/g, ')',)
			.replace(/\\([[\]()])/g, '$1',)
		const value = getAttr(`<option${attrs}>`, 'value',)
		options.push(value !== undefined ? value : text,)
	}
	const prompt = getAttr(openTag, 'label',)
	return {
		...(id ? {id,} : {}),
		...(prompt ? {prompt,} : {}),
		options,
	}
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

/** Result of up-converting v1 HTML: token-form text plus the select definitions extracted from it. */
export interface HtmlUpconvertResult {
	/** The text with legacy form elements replaced by tokens / references. */
	text: string
	/** Definitions extracted from legacy `<select>` elements, in document order. */
	selects: SelectDefinition[]
}

/**
 * Up-converts legacy (schema v1) reason text to token form: `<input>` and
 * `<textarea>` elements become inline tokens, `<br>` becomes a paragraph
 * break, and each `<select>` is extracted into a {@link SelectDefinition}
 * with a `{select:name}` reference left in its place.
 *
 * Legacy selects don't need an `id` attribute. One with a valid, untaken id
 * keeps it as the definition name; all others are numbered sequentially
 * (`select-1`, `select-2`, ...) in document order, skipping a number only when
 * that exact name is taken. The numbering is deterministic, so re-converting
 * the same HTML always yields the same names and reconcile equality between
 * the NXG config and the legacy mirror converges.
 *
 * Token-form text passes through unchanged with no extracted definitions, so
 * this is safe (and idempotent) to apply to any reason text regardless of
 * origin. The input must already have entity-encoded angle brackets decoded
 * (see `decodeHtmlAngleBrackets`).
 * @param text The reason text to up-convert.
 * @param existingSelects Definitions the reason already has; their names are
 * reserved so extraction can't mint a colliding name. Not included in the
 * returned `selects` - the caller merges.
 */
export function htmlFieldsToTokens (
	text: string,
	existingSelects?: SelectDefinition[],
): HtmlUpconvertResult {
	const taken = new Set((existingSelects ?? []).map((d,) => d.name),)
	const selects: SelectDefinition[] = []
	let counter = 0
	const converted = text.replace(LEGACY_HTML_RE, (matched,) => {
		if (/^<br/i.test(matched,)) { return '\n\n' }
		if (/^<select/i.test(matched,)) {
			const {id, ...definition} = selectHtmlToDefinition(matched,)
			let name = id
			if (!name || !SELECT_NAME_RE.test(name,) || taken.has(name,)) {
				do {
					name = `select-${++counter}`
				} while (taken.has(name,))
			}
			taken.add(name,)
			selects.push({name, ...definition,},)
			return `{select:${name}}`
		}
		return serializeToken(fieldHtmlToToken(matched,),)
	},)
	return {text: converted, selects,}
}

/**
 * Up-converts only the inline legacy fields - `<input>`, `<textarea>`, and
 * `<br>` - leaving any `<select>` HTML untouched. Used for the removal
 * message header and footer, which have no owning reason to hold select
 * definitions (and where selects were never functional fill-ins anyway).
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
 * double-escaped (including stripping a `\)`, which the up-convert would
 * remove anyway), and the up-convert strips these escapes again on the way
 * back (see `selectHtmlToDefinition`).
 */
function escapeOptionMarkdown (text: string,): string {
	return text
		.replace(/\\?([[\](])/g, '\\$1',)
		.replace(/\\\)/g, ')',)
}

/**
 * Serializes an interactive token to the legacy HTML element 6.x understands.
 * A select's definition name becomes the `id` attribute and its prompt a
 * `label` attribute (whitelisted by the reason parser, invisible in 6.x, and
 * recovered by the up-convert). Option line breaks collapse to spaces because
 * v1 options are single-line, and markdown link characters are
 * backslash-escaped to survive 6.x's markdown pass.
 */
export function tokenToLegacyHtml (token: InteractiveToken,): string {
	const idAttr = token.id ? ` id="${escapeAttr(token.id,)}"` : ''
	switch (token.kind) {
		case 'select': {
			const labelAttr = token.placeholder
				? ` label="${escapeAttr(token.placeholder,)}"`
				: ''
			const options = token.options
				.map((option,) => `<option>${escapeOptionMarkdown(option.replace(/\s*\r?\n\s*/g, ' ',),)}</option>`)
				.join('',)
			return `<select${idAttr}${labelAttr}>${options}</select>`
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
 * Down-converts token-form reason text to the legacy HTML form for the
 * classic (schema v1) wiki mirror: inline tokens become HTML form elements
 * and `{select:name}` references are expanded into full `<select>` elements
 * from the given definitions. An unresolved reference is a text segment and
 * so stays literal on the mirror. Literal text - including paragraph breaks,
 * which 6.x handles fine as newlines - passes through unchanged.
 * @param text The token-form reason text.
 * @param selects The reason's select definitions, used to expand references.
 */
export function tokensToHtmlFields (text: string, selects?: SelectDefinition[],): string {
	return parseReasonSegments(text, selects,)
		.map((segment,) => segment.type === 'text' ? segment.text : tokenToLegacyHtml(segment.token,))
		.join('',)
}
