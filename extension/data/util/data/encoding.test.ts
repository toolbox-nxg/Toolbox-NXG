/** Tests for encoding utilities. */

import {deflate as pakoDeflate, inflate as pakoInflate,} from 'pako'
import {afterEach, describe, expect, it, vi,} from 'vitest'

import {
	base64ToBytes,
	bytesToBase64,
	htmlDecode,
	htmlEncode,
	tbDecode,
	unescapeJSON,
	zlibDeflate,
	zlibInflate,
} from './encoding'

describe('encoding utilities', () => {
	it('decodes URI-encoded and legacy escaped strings', () => {
		expect(tbDecode('hello%20world',),).toBe('hello world',)
		expect(tbDecode('%u2713',),).toBe('✓',)
	})

	it('unescapes reddit JSON HTML entities', () => {
		expect(unescapeJSON('{&quot;a&quot;:&quot;&lt;b&gt;&amp;&quot;}',),).toBe('{"a":"<b>&"}',)
	})

	it('encodes and decodes HTML with the DOM', () => {
		expect(htmlEncode('<strong>Tom & Jerry</strong>',),).toBe('&lt;strong&gt;Tom &amp; Jerry&lt;/strong&gt;',)
		expect(htmlDecode('&lt;strong&gt;Tom &amp; Jerry&lt;/strong&gt;',),).toBe('<strong>Tom & Jerry</strong>',)
	})

	describe('htmlDecode without a DOM (service worker)', () => {
		afterEach(() => {
			vi.unstubAllGlobals()
		},)

		it('decodes common and numeric entities via the string fallback', () => {
			vi.stubGlobal('document', undefined,)
			expect(htmlDecode('Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;',),).toBe('Tom & <b>Jerry</b>',)
			expect(htmlDecode('it&#39;s &quot;ok&quot;',),).toBe('it\'s "ok"',)
			expect(htmlDecode('&#x2764;',),).toBe('❤',)
			// `&amp;` is decoded last so already-escaped entities survive one pass.
			expect(htmlDecode('&amp;lt;',),).toBe('&lt;',)
		})
	})

	it('round-trips zlib-compressed strings', () => {
		const input = JSON.stringify({users: {alice: [{note: 'hello',},],},},)

		expect(zlibInflate(zlibDeflate(input,),),).toBe(input,)
	})

	it('round-trips non-Latin-1 text (emoji, CJK, curly quotes)', () => {
		const input = JSON.stringify({note: 'café 日本語 \u{1f600} “quote”',},)

		expect(zlibInflate(zlibDeflate(input,),),).toBe(input,)
	})

	it('interops with pako string mode in both directions (legacy toolbox / 6.x)', () => {
		const text = 'emoji \u{1f600} CJK 日本語 curly “”'

		// A blob 6.x wrote (pako.deflate on a string is UTF-8) must inflate cleanly.
		expect(zlibInflate(bytesToBase64(pakoDeflate(text,),),),).toBe(text,)
		// Our output must inflate back to the original UTF-8 bytes, so any pako-based
		// decoder (legacy toolbox / 6.x) reads it.
		expect(new TextDecoder().decode(pakoInflate(base64ToBytes(zlibDeflate(text,),),),),).toBe(text,)
	})
})
