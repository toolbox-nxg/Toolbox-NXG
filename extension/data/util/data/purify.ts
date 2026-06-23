/** HTML sanitization utilities wrapping DOMPurify, with support for deep-sanitizing settings objects. */

import DOMPurify from 'dompurify'

import {htmlDecode,} from './encoding'

/**
 * Sanitizes an untrusted string and returns sanitized HTML markup, suitable for
 * `dangerouslySetInnerHTML`. This is the sink-side sanitizer: every
 * `dangerouslySetInnerHTML` consumer of untrusted data should wrap its value
 * here, so the decision "this becomes live markup" lives next to the sink rather
 * than being inferred elsewhere.
 *
 * Pass real markup. Locally rendered markdown already is. API fields that arrive
 * entity-encoded (e.g. Reddit's `body_html`) are decoded to real markup by
 * {@link purifyObject} before they reach a sink, so DOMPurify actually inspects
 * the tags. (Given raw entity-encoded input, DOMPurify would see only text and
 * strip nothing - so never hand a sink an undecoded `*_html` field.)
 */
export function purifyHTML (input: string,): string {
	return DOMPurify.sanitize(input,)
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
 * Walks an object and sanitizes every string value, decoding each to display-ready
 * plain text via {@link purify}. Strings that parse as JSON objects are decoded,
 * sanitized in place, and re-serialized.
 *
 * Every value is treated uniformly - the walker makes no per-key guesses about
 * whether a field is later rendered as text or as HTML. The few consumers that
 * render a field via `dangerouslySetInnerHTML` (e.g. Reddit's `body_html` /
 * `selftext_html`) re-sanitize it with {@link purifyHTML} at the sink; because the
 * value arrives here as real (decoded) markup, that sink-side DOMPurify pass
 * actually inspects the tags.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-place recursive sanitizer that reads and writes arbitrary keys on untrusted parsed JSON
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
					} catch {
						// Not json. Decode to display-ready plain text; innerHTML sinks
						// re-sanitize with purifyHTML at the point of use.
						input[key] = purify(input[key],)
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
