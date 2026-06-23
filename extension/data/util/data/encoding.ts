/** Encoding and decoding utilities: URI escaping, HTML entities, and zlib compression. */

import {deflate as pakoDeflate, inflate as pakoInflate,} from 'pako'

/**
 * Decodes a string previously encoded with the legacy `escape()` function.
 * Tries `decodeURIComponent` first (correct for new data encoded with
 * `encodeURIComponent`), then falls back to `unescape` to handle old wiki
 * data that may contain non-standard `%uXXXX` sequences.
 *
 * @deprecated Remove in 9.x once legacy escape()-encoded wiki configs are no longer supported.
 */
export function tbDecode (s: string,): string {
	try {
		return decodeURIComponent(s,)
	} catch {
		return unescape(s,)
	}
}

/**
 * Encodes a string with legacy `escape()` semantics for the classic (schema
 * v1) wiki mirror. 6.x reads removal reason text, macro text, and the removal
 * header/footer with an unconditional `unescape()`, so those fields must be
 * written escape()-encoded - and specifically with `escape()` rather than
 * `encodeURIComponent()`, because `unescape()` decodes `%XX` as Latin-1 and
 * would mangle UTF-8 sequences; `escape()`'s `%uXXXX` form round-trips.
 *
 * @deprecated Remove in 9.x along with {@link tbDecode} once classic-schema
 * wiki mirrors are no longer written.
 */
export function legacyEscape (s: string,): string {
	return escape(s,)
}

/**
 * Reverses the HTML entity encoding Reddit applies to its JSON responses so the
 * payload can be parsed.
 */
export function unescapeJSON (val: string,): string {
	if (typeof val === 'string') {
		val = val.replace(/&quot;/g, '"',)
			.replace(/&gt;/g, '>',).replace(/&lt;/g, '<',)
			.replace(/&amp;/g, '&',)
	}
	return val
}

/**
 * Escapes text for HTML using the browser's DOM engine, which handles all
 * HTML entities. Unlike {@link util/data/string!escapeHTML}, which uses a fixed char map for
 * six common characters, this encodes comprehensively via textContent/innerHTML.
 */
export function htmlEncode (value: string,): string {
	const div = document.createElement('div',)
	div.textContent = value
	return div.innerHTML
}

/**
 * Gets the text content of an HTML string. Uses the DOM where available (handles
 * every entity); in a DOM-less context such as the background service worker it
 * falls back to decoding the entities an HTML serializer emits plus numeric
 * entities, so callers like {@link util/data/purify!purify} don't throw when
 * sanitizing API responses off the main thread.
 */
export function htmlDecode (value: string,): string {
	if (typeof document !== 'undefined') {
		const div = document.createElement('div',)
		div.innerHTML = value
		return div.textContent ?? ''
	}
	// `&amp;` must be decoded last so `&amp;lt;` yields `&lt;`, not `<`.
	return value
		.replace(/&lt;/g, '<',)
		.replace(/&gt;/g, '>',)
		.replace(/&quot;/g, '"',)
		.replace(/&nbsp;/g, ' ',)
		.replace(/&#(\d+);/g, (_, code,) => String.fromCodePoint(Number(code,),),)
		.replace(/&#x([0-9a-f]+);/gi, (_, code,) => String.fromCodePoint(parseInt(code, 16,),),)
		.replace(/&amp;/g, '&',)
}

/**
 * Decompresses a base64-encoded, zlib-compressed string back into its data.
 */
export function zlibInflate (stringThing: string,): string {
	// Decode base64 -> binary string -> Uint8Array, then inflate raw bytes.
	// Convert result as Latin-1 (charCode per byte) to match the encoding
	// used by pako 0.2.x, which stored data as a Latin-1 byte sequence.
	const binary = atob(stringThing,)
	const bytes = Uint8Array.from(binary, (c,) => c.charCodeAt(0,),)
	const raw = pakoInflate(bytes,)
	return Array.from(raw, (b,) => String.fromCharCode(b,),).join('',)
}

/**
 * Compresses data with zlib and returns it as a base64-encoded string.
 */
export function zlibDeflate (objThing: string,): string {
	// Encode input as Latin-1 bytes (charCode per char) to match pako 0.2.x
	// behavior, then deflate and base64-encode the result.
	const input = Uint8Array.from(objThing, (c,) => c.charCodeAt(0,) & 0xff,)
	const compressed = pakoDeflate(input,)
	return btoa(Array.from(compressed, (b,) => String.fromCharCode(b,),).join('',),)
}

/**
 * Encodes raw bytes as a base64 string. Chunked so large arrays don't blow
 * the argument-spread call stack limit.
 */
export function bytesToBase64 (bytes: Uint8Array,): string {
	const chunks: string[] = []
	for (let i = 0; i < bytes.length; i += 0x8000) {
		chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000,),),)
	}
	return btoa(chunks.join('',),)
}

/**
 * Decodes a base64 string into raw bytes.
 */
export function base64ToBytes (text: string,): Uint8Array {
	const binary = atob(text,)
	return Uint8Array.from(binary, (c,) => c.charCodeAt(0,),)
}

/**
 * Returns the UTF-8 byte length of a string - the size it occupies once
 * serialized, which is what Reddit's wiki page limits are measured against.
 */
export function byteLength (text: string,): number {
	return new TextEncoder().encode(text,).length
}
