/** Tests for encoding utilities. */

import {describe, expect, it,} from 'vitest'

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

	it('round-trips zlib-compressed strings', () => {
		const input = JSON.stringify({users: {alice: [{note: 'hello',},],},},)

		expect(zlibInflate(zlibDeflate(input,),),).toBe(input,)
	})
})
