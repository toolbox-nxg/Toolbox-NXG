/**
 * A small position-aware JSON parser.
 *
 * `JSON.parse` reports syntax errors with inconsistent (and browser-specific)
 * position info, and provides no way to map a parsed node back to its place
 * in the source text. This parser produces both:
 *
 * - the parsed value, plus a span (character offsets) for every node, keyed
 *   by its path (`''` for the root, `'a.b'`, `'reasons.3.text'`, ...), so
 *   schema validators can point diagnostics at the exact value, and
 * - on malformed input, a {@link JsonSyntaxError} carrying the exact offset.
 *
 * It accepts exactly the JSON grammar (no comments or trailing commas), the
 * same set of documents `JSON.parse` accepts.
 */

/** The character span of one JSON node in the source text. */
export interface JsonSpan {
	/** Offset of the node's first character. */
	from: number
	/** Offset just past the node's last character. */
	to: number
}

/** A successfully parsed document with per-node source spans. */
export interface PositionalJsonResult {
	/** The parsed value, identical to `JSON.parse` output. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary parsed JSON, mirroring JSON.parse's any return
	value: any
	/**
	 * Source span of every node, keyed by path: `''` is the root, object
	 * members append `.key`, array elements append `.index` (no leading dot
	 * at the root, so a top-level key `a` has path `'a'`).
	 */
	spans: Map<string, JsonSpan>
}

/** A JSON syntax error with the source offset where parsing failed. */
export class JsonSyntaxError extends Error {
	/** Character offset of the offending position in the source text. */
	position: number

	constructor (message: string, position: number,) {
		super(message,)
		this.name = 'JsonSyntaxError'
		this.position = position
	}
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r',],)

/**
 * Matches one JSON number token. Sticky (`y`) so it anchors at `lastIndex`
 * without scanning forward and without copying the tail of the document per
 * token (a plain `.slice(pos).match()` is O(n) per number, O(n^2) overall).
 * No leading `^`: the `y` flag already anchors at `lastIndex`, and `^` would
 * instead require `lastIndex === 0`.
 */
const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

/**
 * Parses JSON text, recording the source span of every node.
 * @param text The JSON document.
 * @throws {JsonSyntaxError} When the text is not valid JSON.
 */
export function parsePositionalJson (text: string,): PositionalJsonResult {
	const spans = new Map<string, JsonSpan>()
	let pos = 0

	function fail (message: string,): never {
		throw new JsonSyntaxError(message, Math.min(pos, text.length,),)
	}

	function skipWhitespace () {
		while (pos < text.length && WHITESPACE.has(text[pos]!,)) { pos++ }
	}

	/** Joins a parent path and a child key into a child path. */
	function childPath (parent: string, key: string | number,): string {
		return parent === '' ? String(key,) : `${parent}.${key}`
	}

	function parseString (): string {
		// Caller guarantees text[pos] === '"'.
		const start = pos
		pos++
		let out = ''
		while (pos < text.length) {
			const ch = text[pos]!
			if (ch === '"') {
				pos++
				return out
			}
			if (ch === '\\') {
				const esc = text[pos + 1]
				switch (esc) {
					case '"':
					case '\\':
					case '/':
						out += esc
						break
					case 'b':
						out += '\b'
						break
					case 'f':
						out += '\f'
						break
					case 'n':
						out += '\n'
						break
					case 'r':
						out += '\r'
						break
					case 't':
						out += '\t'
						break
					case 'u': {
						const hex = text.slice(pos + 2, pos + 6,)
						if (!/^[0-9a-fA-F]{4}$/.test(hex,)) { fail('invalid unicode escape',) }
						out += String.fromCharCode(Number.parseInt(hex, 16,),)
						pos += 4
						break
					}
					default:
						fail('invalid escape sequence',)
				}
				pos += 2
				continue
			}
			// Control characters must be escaped in JSON strings.
			if (ch < ' ') { fail('unescaped control character in string',) }
			out += ch
			pos++
		}
		pos = start
		fail('unterminated string',)
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive JSON parser producing arbitrary node values
	function parseValue (path: string,): any {
		skipWhitespace()
		if (pos >= text.length) { fail('unexpected end of input',) }
		const from = pos
		const ch = text[pos]!
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accumulates an arbitrary parsed JSON node
		let value: any

		if (ch === '{') {
			pos++
			value = {}
			skipWhitespace()
			if (text[pos] === '}') {
				pos++
			} else {
				for (;;) {
					skipWhitespace()
					if (text[pos] !== '"') { fail('expected string key',) }
					const key = parseString()
					skipWhitespace()
					if (text[pos] !== ':') { fail('expected ":" after key',) }
					pos++
					value[key] = parseValue(childPath(path, key,),)
					skipWhitespace()
					if (text[pos] === ',') {
						pos++
						continue
					}
					if (text[pos] === '}') {
						pos++
						break
					}
					fail('expected "," or "}" in object',)
				}
			}
		} else if (ch === '[') {
			pos++
			value = []
			skipWhitespace()
			if (text[pos] === ']') {
				pos++
			} else {
				for (let index = 0;; index++) {
					value.push(parseValue(childPath(path, index,),),)
					skipWhitespace()
					if (text[pos] === ',') {
						pos++
						continue
					}
					if (text[pos] === ']') {
						pos++
						break
					}
					fail('expected "," or "]" in array',)
				}
			}
		} else if (ch === '"') {
			value = parseString()
		} else if (ch === '-' || (ch >= '0' && ch <= '9')) {
			NUMBER_RE.lastIndex = pos
			const match = NUMBER_RE.exec(text,)
			if (!match) { fail('invalid number',) }
			value = Number(match[0],)
			pos += match[0].length
		} else if (text.startsWith('true', pos,)) {
			value = true
			pos += 4
		} else if (text.startsWith('false', pos,)) {
			value = false
			pos += 5
		} else if (text.startsWith('null', pos,)) {
			value = null
			pos += 4
		} else {
			fail('unexpected character',)
		}

		spans.set(path, {from, to: pos,},)
		return value
	}

	const value = parseValue('',)
	skipWhitespace()
	if (pos < text.length) { fail('unexpected trailing content',) }
	return {value, spans,}
}

/**
 * Converts a character offset to a 1-based line number, for error messages
 * in contexts without a line-aware editor.
 * @param text The source text.
 * @param offset The character offset.
 */
export function offsetToLine (text: string, offset: number,): number {
	let line = 1
	const end = Math.min(offset, text.length,)
	for (let i = 0; i < end; i++) {
		if (text[i] === '\n') { line++ }
	}
	return line
}
