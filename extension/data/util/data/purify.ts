/** HTML sanitization utilities wrapping DOMPurify, with support for deep-sanitizing settings objects. */

import DOMPurify from 'dompurify'

import {htmlDecode,} from './encoding'

/**
 * Keys whose values are HTML markup rendered via `dangerouslySetInnerHTML`
 * rather than as plain text. Reddit returns these entity-encoded; we leave that
 * encoding intact (so the innerHTML sink decodes it to markup as before) instead
 * of routing them through {@link purify}, which would decode the entities into a
 * raw markup string and defeat the sink's safety. See {@link purify} for why
 * plain-text values are handled differently.
 */
const HTML_MARKUP_KEYS = new Set([
	'body_html',
	'selftext_html',
	'description_html',
	'public_description_html',
	'content_html',
],)

/**
 * Sanitizes an untrusted string and returns sanitized HTML markup, suitable for
 * `dangerouslySetInnerHTML`. Callers must pass real markup (e.g. locally rendered
 * markdown); entity-encoded input passes through unchanged because DOMPurify sees
 * only text and has nothing to strip.
 */
export function purifyHTML (input: string,): string {
	return DOMPurify.sanitize(input,) as unknown as string
}

/**
 * Sanitizes an untrusted string and returns display-ready plain text. DOMPurify
 * strips any dangerous markup; {@link util/data/encoding!htmlDecode} then converts the
 * entity-encoded output back to literal characters, so values rendered as React
 * text nodes or `.textContent` show `<` rather than `&lt;`. Values destined for
 * `dangerouslySetInnerHTML` must use {@link purifyHTML} instead.
 */
export function purify (input: string,): string {
	return htmlDecode(purifyHTML(input,),)
}

/**
 * Walks an object and sanitizes every string value as untrusted HTML. Strings
 * that parse as JSON objects are decoded, sanitized in place, and serialized
 * back to JSON.
 */
export function purifyObject (input: any,) {
	for (const key in input) {
		if (Object.prototype.hasOwnProperty.call(input, key,)) {
			const itemType = typeof input[key]
			switch (itemType) {
				case 'object':
					purifyObject(input[key],)
					break
				case 'string':
					// If the string we're handling is a JSON string, purifying it before it's parsed will mangle
					// the JSON and make it unusable. We try to parse every value, and if parsing returns an object
					// or an array, we run purifyObject on the result and re-stringify the value, rather than
					// trying to purify the string itself. This ensures that when the string is parsed somewhere
					// else, it's already purified. Wiki config values sometimes contain JSON-encoded sub-objects,
					// so this path is live.
					try {
						const jsonObject = JSON.parse(input[key],)
						// We only want to purify the parsed value if it's an object or array, otherwise we throw
						// back and purify the raw string instead
						if (typeof jsonObject !== 'object' || jsonObject == null) {
							throw new Error('not using the parsed result of this string',)
						}
						purifyObject(jsonObject,)
						input[key] = JSON.stringify(jsonObject,)
					} catch (e) {
						// Not json. HTML-markup fields stay entity-encoded so their
						// innerHTML sink decodes them as before; everything else becomes
						// display-ready plain text.
						input[key] = HTML_MARKUP_KEYS.has(key,)
							? purifyHTML(input[key],)
							: purify(input[key],)
					}
					break
				case 'function':
					// If we are dealing with an actual function something is really wrong and we'll overwrite it.
					input[key] = 'function'
					break
				case 'number':
				case 'boolean':
				case 'undefined':
					// Do nothing with these as they are supposed to be safe.
					break
				default:
					input[key] = `unknown item type ${itemType}`
			}
		}
	}
}
