/** Tests for encoding utilities. */

import {afterEach, describe, expect, it, vi,} from 'vitest'

import {htmlDecode, htmlEncode, tbDecode, unescapeJSON, zlibDeflate, zlibInflate,} from './encoding'

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
})
