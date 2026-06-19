/** Tests for the position-aware JSON parser. */

import {describe, expect, it,} from 'vitest'
import {JsonSyntaxError, offsetToLine, parsePositionalJson,} from './positionalJson'

describe('parsePositionalJson', () => {
	it('parses every JSON value type identically to JSON.parse', () => {
		const text = '{"a": 1.5e2, "b": [true, false, null, "s\\n\\u0041"], "c": {"d": -0.5}}'
		expect(parsePositionalJson(text,).value,).toEqual(JSON.parse(text,),)
	})

	it('records spans for nested paths', () => {
		const text = '{"a": {"b": [10, "x"]}}'
		const {spans,} = parsePositionalJson(text,)

		expect(spans.get('',),).toEqual({from: 0, to: text.length,},)
		expect(text.slice(spans.get('a.b',)!.from, spans.get('a.b',)!.to,),).toBe('[10, "x"]',)
		expect(text.slice(spans.get('a.b.0',)!.from, spans.get('a.b.0',)!.to,),).toBe('10',)
		expect(text.slice(spans.get('a.b.1',)!.from, spans.get('a.b.1',)!.to,),).toBe('"x"',)
	})

	it('throws JsonSyntaxError with the offending position', () => {
		try {
			parsePositionalJson('{"a": 1,}',)
			expect.unreachable('should have thrown',)
		} catch (err) {
			expect(err,).toBeInstanceOf(JsonSyntaxError,)
			expect((err as JsonSyntaxError).position,).toBe(8,)
		}
	})

	it.each([
		['', 'unexpected end',],
		['{', 'expected string key',],
		['{"a" 1}', 'expected ":"',],
		['[1 2]', 'expected "," or "]"',],
		['"abc', 'unterminated string',],
		['{"a": 1} trailing', 'trailing content',],
		['nope', 'unexpected character',],
		['01', 'trailing content',],
	],)('rejects malformed input %j', (text, messagePart,) => {
		expect(() => parsePositionalJson(text,)).toThrowError(messagePart,)
	},)

	it('parses documents JSON.parse accepts that look like edge cases', () => {
		expect(parsePositionalJson('  [ ]  ',).value,).toEqual([],)
		expect(parsePositionalJson('{ }',).value,).toEqual({},)
		expect(parsePositionalJson('"top-level string"',).value,).toBe('top-level string',)
		expect(parsePositionalJson('-0.5e-2',).value,).toBe(-0.005,)
	})
})

describe('offsetToLine', () => {
	it('converts offsets to 1-based line numbers', () => {
		const text = 'one\ntwo\nthree'
		expect(offsetToLine(text, 0,),).toBe(1,)
		expect(offsetToLine(text, 4,),).toBe(2,)
		expect(offsetToLine(text, text.length,),).toBe(3,)
	})
})
