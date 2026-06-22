/** Tests for HTML sanitization utilities. */

import {describe, expect, it,} from 'vitest'

import {purify, purifyHTML, purifyObject,} from './purify'

// Reddit HTML-entity-encodes text fields in its JSON responses, so the values
// that flow through `purifyObject` arrive encoded (e.g. `&lt;` for `<`). These
// tests use that encoded form rather than raw characters.

describe('purify', () => {
	it('returns plain text with entities decoded, not re-encoded', () => {
		// The reported automod bug: the encoded `&lt;` must render as `<`, not the
		// literal `&lt;`, when dropped into a React text node.
		expect(purify('Comment with &lt; 51 characters',),).toBe('Comment with < 51 characters',)
		expect(purify('Tom &amp; Jerry',),).toBe('Tom & Jerry',)
	})

	it('decodes encoded markup to its literal text form (safe in a text node)', () => {
		// A plain-text field whose content happens to look like a tag is the user's
		// literal text; purify returns it decoded, to be rendered (auto-escaped) as
		// a React text node rather than interpreted as markup.
		expect(purify('Said &lt;b&gt;hi&lt;/b&gt;',),).toBe('Said <b>hi</b>',)
	})
})

describe('purifyHTML', () => {
	// Note: DOMPurify's tag/attribute stripping is exercised in the real DOM, not
	// under the happy-dom test environment (where DOMPurify is unreliable). Here we
	// pin one deterministic property: entity-encoded markup round-trips untouched,
	// because DOMPurify sees it as text. That's exactly why a sink must never be
	// handed an undecoded `*_html` field - purifyObject decodes it to real markup
	// first, so this sink-side pass actually inspects the tags.
	it('leaves entity-encoded markup unchanged', () => {
		expect(purifyHTML('&lt;b&gt;x&lt;/b&gt;',),).toBe('&lt;b&gt;x&lt;/b&gt;',)
	})
})

describe('purifyObject', () => {
	it('decodes every string value to plain text, with no per-key HTML denylist', () => {
		const input = {details: 'a &lt; b', body_html: '&lt;b&gt;x&lt;/b&gt;',}
		purifyObject(input,)
		expect(input.details,).toBe('a < b',)
		// body_html is decoded like any other field; the innerHTML sinks
		// (TBComment/TBSubmission) re-sanitize the decoded markup with purifyHTML.
		expect(input.body_html,).toBe('<b>x</b>',)
	})

	it('recurses into nested objects', () => {
		const input = {data: {title: 'x &lt; y',},}
		purifyObject(input,)
		expect(input.data.title,).toBe('x < y',)
	})
})
