/**
 * Pre-save validation for the raw wiki editor: JSON syntax checking with
 * exact source positions, plus shape checks for the toolbox config and
 * usernotes schemas. Diagnostics are rendered as live line highlights by the
 * CodeMirror lint integration, and syntax errors block saving.
 *
 * Shape problems are warnings, not errors - `normalizeConfig` coerces most
 * of them on read, and 6.x tolerates extra fields - but a mod hand-editing
 * the page almost certainly wants to know about them before saving.
 */

import {JsonSyntaxError, offsetToLine, parsePositionalJson,} from '../../../data/positionalJson'
import type {JsonSpan, PositionalJsonResult,} from '../../../data/positionalJson'
import {NXG_USERNOTES_FORMAT, NXG_USERNOTES_VER,} from '../usernotes/schema'
import {USERNOTES_MANIFEST_FORMAT, USERNOTES_MANIFEST_VER,} from '../usernotes/sharding'

/** One validation finding, with character offsets into the editor text. */
export interface WikiEditorDiagnostic {
	from: number
	to: number
	/** `'error'` blocks saving (syntax); `'warning'` highlights but saves. */
	severity: 'error' | 'warning'
	message: string
}

/** The wiki editor pages this validator knows the schema of. */
export type ValidatablePage = 'toolbox' | 'usernotes' | 'usernotesShard'

/** Builds diagnostics against the parsed document's path spans. */
class DiagnosticCollector {
	diagnostics: WikiEditorDiagnostic[] = []
	private spans: Map<string, JsonSpan>

	constructor (parsed: PositionalJsonResult,) {
		this.spans = parsed.spans
	}

	/** Adds a warning pointing at the node with the given path. */
	warn (path: string, message: string,) {
		const span = this.spans.get(path,) ?? this.spans.get('',) ?? {from: 0, to: 0,}
		this.diagnostics.push({from: span.from, to: span.to, severity: 'warning', message,},)
	}

	/** Warns unless `value` is an array; returns whether it is one. */
	expectArray (value: unknown, path: string, label: string,): value is unknown[] {
		if (value === undefined || Array.isArray(value,)) { return Array.isArray(value,) }
		this.warn(path, `${label} should be an array`,)
		return false
	}

	/** Warns unless `value` is a plain object; returns whether it is one. */
	expectObject (value: unknown, path: string, label: string,): value is Record<string, unknown> {
		const isObject = !!value && typeof value === 'object' && !Array.isArray(value,)
		if (value !== undefined && !isObject) {
			this.warn(path, `${label} should be an object`,)
		}
		return isObject
	}

	/** Warns when `value` is present but not a string. */
	expectString (value: unknown, path: string, label: string,) {
		if (value !== undefined && typeof value !== 'string') {
			this.warn(path, `${label} should be a string`,)
		}
	}
}

/** Validates the toolbox subreddit config shape (works for both schema v1 and v2). */
function validateToolboxConfig (parsed: PositionalJsonResult, collector: DiagnosticCollector,) {
	const config = parsed.value as Record<string, unknown>

	if (config.ver !== undefined && typeof config.ver !== 'number') {
		collector.warn('ver', 'ver should be a number',)
	}

	if (collector.expectObject(config.removalReasons, 'removalReasons', 'removalReasons',)) {
		const reasons = config.removalReasons.reasons
		if (collector.expectArray(reasons, 'removalReasons.reasons', 'removalReasons.reasons',)) {
			reasons.forEach((reason, i,) => {
				const path = `removalReasons.reasons.${i}`
				if (!collector.expectObject(reason, path, `reason #${i + 1}`,)) { return }
				collector.expectString(reason.text, `${path}.text`, `reason #${i + 1} text`,)
				collector.expectString(reason.title, `${path}.title`, `reason #${i + 1} title`,)
			},)
		}
		collector.expectString(config.removalReasons.header, 'removalReasons.header', 'removalReasons.header',)
		collector.expectString(config.removalReasons.footer, 'removalReasons.footer', 'removalReasons.footer',)
	}

	if (collector.expectArray(config.modMacros, 'modMacros', 'modMacros',)) {
		config.modMacros.forEach((macro, i,) => {
			const path = `modMacros.${i}`
			if (!collector.expectObject(macro, path, `macro #${i + 1}`,)) { return }
			collector.expectString(macro.text, `${path}.text`, `macro #${i + 1} text`,)
		},)
	}

	if (config.banMacros !== undefined && config.banMacros !== null) {
		collector.expectObject(config.banMacros, 'banMacros', 'banMacros',)
	}
}

/**
 * Validates the usernotes page shape: the legacy v6 page in both its
 * compressed (blob) and decompressed (users object) forms, plus the v7 shard
 * manifest stored on the NXG usernotes page.
 */
function validateUsernotes (parsed: PositionalJsonResult, collector: DiagnosticCollector,) {
	const notes = parsed.value as Record<string, unknown>

	// The NXG usernotes page holds the v7 shard manifest rather than note data.
	if (notes.format === USERNOTES_MANIFEST_FORMAT) {
		if (notes.ver !== USERNOTES_MANIFEST_VER) {
			collector.warn(
				'ver',
				`unsupported manifest schema version ${notes.ver} (expected ${USERNOTES_MANIFEST_VER})`,
			)
			return
		}
		if (typeof notes.gen !== 'number') {
			collector.warn('gen', 'gen should be a number',)
		}
		collector.expectArray(notes.types, 'types', 'types',)
		if (!Array.isArray(notes.shards,)) {
			collector.warn('shards', 'the manifest needs a shards array',)
		}
		return
	}

	if (typeof notes.ver !== 'number') {
		collector.warn('ver', 'usernotes need a numeric ver field (6)',)
		return
	}
	if (notes.ver !== 6) {
		collector.warn('ver', `unsupported usernotes schema version ${notes.ver} (expected 6)`,)
		return
	}

	if (typeof notes.blob !== 'string' && !collector.expectObject(notes.users, 'users', 'users',)) {
		collector.warn('', 'v6 usernotes need either a blob string or a users object',)
	}
	if (notes.blob !== undefined && typeof notes.blob !== 'string') {
		collector.warn('blob', 'blob should be a base64 string',)
	}
	collector.expectObject(notes.constants, 'constants', 'constants',)
}

/**
 * Validates an NXG usernotes shard page shape, both compressed (envelope with
 * a zlib/base64 `blob`) and decompressed (editable `users` object) JSON.
 */
function validateUsernotesShard (parsed: PositionalJsonResult, collector: DiagnosticCollector,) {
	const page = parsed.value as Record<string, unknown>

	if (page.format !== NXG_USERNOTES_FORMAT) {
		collector.warn('format', `shard pages need a format field of "${NXG_USERNOTES_FORMAT}"`,)
		return
	}
	if (page.ver !== NXG_USERNOTES_VER) {
		collector.warn('ver', `unsupported shard schema version ${page.ver} (expected ${NXG_USERNOTES_VER})`,)
		return
	}

	if (typeof page.blob !== 'string' && !collector.expectObject(page.users, 'users', 'users',)) {
		collector.warn('', 'shard pages need either a blob string or a users object',)
	}
	if (page.blob !== undefined && typeof page.blob !== 'string') {
		collector.warn('blob', 'blob should be a base64 string',)
	}
}

/**
 * Validates wiki editor text for a JSON page, returning diagnostics with
 * character offsets. Syntax errors yield a single `'error'`; schema shape
 * problems yield `'warning'`s. Returns `[]` for blank text.
 * @param text The current editor text.
 * @param page Which page's schema to check against.
 */
export function validateWikiEditorJson (text: string, page: ValidatablePage,): WikiEditorDiagnostic[] {
	if (text.trim() === '') { return [] }

	let parsed: PositionalJsonResult
	try {
		parsed = parsePositionalJson(text,)
	} catch (err) {
		if (err instanceof JsonSyntaxError) {
			return [{
				from: err.position,
				to: Math.min(err.position + 1, text.length,),
				severity: 'error',
				message: `JSON syntax error (line ${offsetToLine(text, err.position,)}): ${err.message}`,
			},]
		}
		throw err
	}

	const collector = new DiagnosticCollector(parsed,)
	if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value,)) {
		collector.warn('', 'the page should be a JSON object',)
		return collector.diagnostics
	}

	if (page === 'toolbox') {
		validateToolboxConfig(parsed, collector,)
	} else if (page === 'usernotesShard') {
		validateUsernotesShard(parsed, collector,)
	} else {
		validateUsernotes(parsed, collector,)
	}
	return collector.diagnostics
}
