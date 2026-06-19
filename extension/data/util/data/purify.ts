/** HTML sanitization utilities wrapping DOMPurify, with support for deep-sanitizing settings objects. */

import DOMPurify from 'dompurify'

/**
 * Cleans an untrusted HTML string by running it through DOMPurify.
 */
export function purify (input: string,): string {
	return DOMPurify.sanitize(input,) as unknown as string
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
						// Not json, simply purify
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
