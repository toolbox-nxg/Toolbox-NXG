/** Tests for the interactive token codec: parsing, serialization, and legacy HTML conversion. */

import {describe, expect, it,} from 'vitest'
import {
	decodeHtmlAngleBrackets,
	htmlFieldsToTokens,
	htmlSimpleFieldsToTokens,
	parseReasonSegments,
	type SelectDefinition,
	serializeToken,
	substituteTokenValues,
	tokensToHtmlFields,
	tokenToLegacyHtml,
} from './tokens'

describe('decodeHtmlAngleBrackets', () => {
	it('decodes single- and double-encoded brackets', () => {
		expect(decodeHtmlAngleBrackets('&lt;select&gt;',),).toBe('<select>',)
		expect(decodeHtmlAngleBrackets('&amp;lt;select&amp;gt;',),).toBe('<select>',)
	})

	it('decodes deeply-encoded brackets (3+ levels of &amp;)', () => {
		expect(decodeHtmlAngleBrackets('&amp;amp;lt;select&amp;amp;gt;',),).toBe('<select>',)
		expect(decodeHtmlAngleBrackets('&amp;amp;amp;amp;lt;select&amp;amp;amp;amp;gt;',),).toBe('<select>',)
	})

	it('leaves plain text untouched', () => {
		expect(decodeHtmlAngleBrackets('no brackets here',),).toBe('no brackets here',)
	})
})

describe('parseReasonSegments', () => {
	it('parses an input token with placeholder', () => {
		const segments = parseReasonSegments('Hello {input: your name} bye',)
		expect(segments,).toEqual([
			{type: 'text', text: 'Hello ',},
			{type: 'token', token: {kind: 'input', placeholder: 'your name', options: [],},},
			{type: 'text', text: ' bye',},
		],)
	})

	it('parses ids, textareas, and select references', () => {
		const selects: SelectDefinition[] = [
			{name: 'rule', prompt: 'Which rule?', options: ['Rule 1', 'Rule 2',],},
		]
		const segments = parseReasonSegments(
			'{textarea#details: More details}{select:rule}',
			selects,
		)
		expect(segments,).toEqual([
			{
				type: 'token',
				token: {kind: 'textarea', id: 'details', placeholder: 'More details', options: [],},
			},
			{
				type: 'token',
				token: {kind: 'select', id: 'rule', placeholder: 'Which rule?', options: ['Rule 1', 'Rule 2',],},
			},
		],)
	})

	it('resolves a select definition without a prompt to an empty placeholder', () => {
		const segments = parseReasonSegments('{select:rule}', [{name: 'rule', options: ['a', 'b',],},],)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'select', id: 'rule', placeholder: '', options: ['a', 'b',],},},
		],)
	})

	it('allows whitespace around the reference name', () => {
		const segments = parseReasonSegments('{select: rule }', [{name: 'rule', options: ['a',],},],)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'select', id: 'rule', placeholder: '', options: ['a',],},},
		],)
	})

	it('leaves an unresolved select reference in the surrounding text', () => {
		const segments = parseReasonSegments(
			'Pick {select:missing} then {input: why}',
			[{name: 'other', options: ['a',],},],
		)
		expect(segments,).toEqual([
			{type: 'text', text: 'Pick {select:missing} then ',},
			{type: 'token', token: {kind: 'input', placeholder: 'why', options: [],},},
		],)
	})

	it('leaves all select references as text when no definitions are passed', () => {
		const segments = parseReasonSegments('Pick {select:rule} now',)
		expect(segments,).toEqual([{type: 'text', text: 'Pick {select:rule} now',},],)
	})

	it('leaves substitution tokens and unknown braces in the text', () => {
		const segments = parseReasonSegments('Hi {author}, removed from {subreddit}. {nonsense: x',)
		expect(segments,).toEqual([
			{type: 'text', text: 'Hi {author}, removed from {subreddit}. {nonsense: x',},
		],)
	})

	it('leaves inline select option syntax as text', () => {
		const segments = parseReasonSegments('{select: a | b}', [{name: 'a', options: ['x',],},],)
		expect(segments,).toEqual([{type: 'text', text: '{select: a | b}',},],)
	})

	it('leaves select tokens with inline ids as text', () => {
		const segments = parseReasonSegments('{select#choice: a | b}',)
		expect(segments,).toEqual([{type: 'text', text: '{select#choice: a | b}',},],)
	})

	it('leaves block select syntax as text', () => {
		const segments = parseReasonSegments(
			'{select#rule: Pick the rule that applies}\n'
				+ '{option} Rule 1 | see [the rules](https://example.com)\n'
				+ '{option} Rule 2\n'
				+ '{/select}',
		)
		expect(segments,).toEqual([
			{
				type: 'text',
				text: '{select#rule: Pick the rule that applies}\n'
					+ '{option} Rule 1 | see [the rules](https://example.com)\n'
					+ '{option} Rule 2\n'
					+ '{/select}',
			},
		],)
	})

	it('resolves the same reference name used twice', () => {
		const selects: SelectDefinition[] = [{name: 'rule', options: ['a', 'b',],},]
		const segments = parseReasonSegments('{select:rule} and {select:rule}', selects,)
		expect(segments.filter((s,) => s.type === 'token'),).toHaveLength(2,)
	})
})

describe('serializeToken', () => {
	it('round-trips through parseReasonSegments', () => {
		const text = '{input#flight: Flight number} and {select:choice} and {textarea: Notes}'
		const selects: SelectDefinition[] = [{name: 'choice', options: ['Yes', 'No',],},]
		const reserialized = parseReasonSegments(text, selects,)
			.map((s,) => s.type === 'text' ? s.text : serializeToken(s.token,))
			.join('',)
		expect(reserialized,).toBe(text,)
	})

	it('sanitizes braces that would break the syntax', () => {
		expect(serializeToken({kind: 'input', placeholder: 'a {b} c', options: [],},),)
			.toBe('{input: a (b) c}',)
	})

	it('serializes a select to its reference only', () => {
		const token = {kind: 'select' as const, id: 'rule', placeholder: 'Pick one', options: ['a', 'b',],}
		expect(serializeToken(token,),).toBe('{select:rule}',)
	})
})

describe('substituteTokenValues', () => {
	it('replaces tokens with values in document order', () => {
		const text = 'Pick {select:choice}, write {input: x}, done'
		const selects: SelectDefinition[] = [{name: 'choice', options: ['a', 'b',],},]
		expect(substituteTokenValues(text, ['B', 'hello',], selects,),).toBe('Pick B, write hello, done',)
	})

	it('uses empty string for missing values and keeps substitution tokens', () => {
		expect(substituteTokenValues('{input: x} {author}', [],),).toBe(' {author}',)
	})

	it('never substitutes an unresolved select reference', () => {
		expect(substituteTokenValues('Pick {select:missing} and {input: x}', ['typed',],),)
			.toBe('Pick {select:missing} and typed',)
	})

	it('does not substitute inline select syntax', () => {
		expect(substituteTokenValues('Pick {select: a | b} and {input: x}', ['b', 'typed',],),)
			.toBe('Pick {select: a | b} and b',)
	})

	it('does not substitute block select syntax', () => {
		const text = 'Pick:\n\n{select: Why?}\n{option} a\n{option} b\n{/select}\n\ndone'
		expect(substituteTokenValues(text, ['b',],),).toBe(text,)
	})
})

describe('htmlFieldsToTokens', () => {
	it('extracts a select with an id into a definition and leaves a reference', () => {
		expect(
			htmlFieldsToTokens('Pick: <select id="rule"><option>Rule 1</option><option>Rule 2</option></select>',),
		).toEqual({
			text: 'Pick: {select:rule}',
			selects: [{name: 'rule', options: ['Rule 1', 'Rule 2',],},],
		},)
	})

	it('numbers id-less selects sequentially in document order', () => {
		expect(
			htmlFieldsToTokens(
				'<select><option>a</option></select> then <select><option>b</option></select>',
			),
		).toEqual({
			text: '{select:select-1} then {select:select-2}',
			selects: [
				{name: 'select-1', options: ['a',],},
				{name: 'select-2', options: ['b',],},
			],
		},)
	})

	it('skips a generated number only when that name is taken', () => {
		const existing: SelectDefinition[] = [{name: 'select-1', options: ['x',],},]
		expect(
			htmlFieldsToTokens('<select><option>a</option></select>', existing,),
		).toEqual({
			text: '{select:select-2}',
			selects: [{name: 'select-2', options: ['a',],},],
		},)
	})

	it('falls back to numbering when the id is taken or not slug-safe', () => {
		const result = htmlFieldsToTokens(
			'<select id="rule"><option>a</option></select>'
				+ '<select id="rule"><option>b</option></select>'
				+ '<select id="not valid!"><option>c</option></select>',
		)
		expect(result,).toEqual({
			text: '{select:rule}{select:select-1}{select:select-2}',
			selects: [
				{name: 'rule', options: ['a',],},
				{name: 'select-1', options: ['b',],},
				{name: 'select-2', options: ['c',],},
			],
		},)
	})

	it('recovers the prompt from a label attribute, omitting it when absent', () => {
		const result = htmlFieldsToTokens(
			'<select id="r" label="Pick one"><option>a</option></select>',
		)
		expect(result.selects,).toEqual([{name: 'r', prompt: 'Pick one', options: ['a',],},],)
		const bare = htmlFieldsToTokens('<select id="r"><option>a</option></select>',)
		expect(bare.selects[0],).not.toHaveProperty('prompt',)
	})

	it('prefers an explicit option value attribute over the text', () => {
		expect(
			htmlFieldsToTokens('<select><option value="short">A much longer label</option></select>',).selects[0]!
				.options,
		).toEqual(['short',],)
	})

	it('recovers the trailing ) of a markdown link inside an option', () => {
		expect(
			htmlFieldsToTokens('<select><option>[see rules](https://example.com/rules\\))</option></select>',)
				.selects[0]!
				.options,
		).toEqual(['[see rules](https://example.com/rules)',],)
	})

	it('tolerates a misspelled </option> closer without merging options', () => {
		expect(
			htmlFieldsToTokens('<select><option>Rule 1</optiom><option>Rule 2</option></select>',).selects[0]!.options,
		).toEqual(['Rule 1', 'Rule 2',],)
	})

	it('strips v1 markdown escapes from option text so links render in token form', () => {
		expect(
			htmlFieldsToTokens(
				'<select><option>**No slurs.** \\[See the rule.\\]\\(https://example.com/rule\\)</option></select>',
			).selects[0]!.options,
		).toEqual(['**No slurs.** [See the rule.](https://example.com/rule)',],)
	})

	it('converts inputs and textareas with id and placeholder', () => {
		expect(htmlFieldsToTokens('<input id="num" placeholder="Flight number">',),)
			.toEqual({text: '{input#num: Flight number}', selects: [],},)
		expect(htmlFieldsToTokens('<textarea id="why" placeholder="Tell us why"></textarea>',),)
			.toEqual({text: '{textarea#why: Tell us why}', selects: [],},)
	})

	it('uses textarea inner text as the placeholder fallback', () => {
		expect(htmlFieldsToTokens('<textarea>Enter Custom reason</textarea>',).text,)
			.toBe('{textarea: Enter Custom reason}',)
	})

	it('converts <br> variants to paragraph breaks', () => {
		expect(htmlFieldsToTokens('one<br>two<br/>three<br />four',).text,)
			.toBe('one\n\ntwo\n\nthree\n\nfour',)
	})

	it('passes token-form and plain text through unchanged (idempotent)', () => {
		const text = 'Hi {author}, {input: reason}, pick {select:rule} — *markdown* stays'
		expect(htmlFieldsToTokens(text, [{name: 'rule', options: ['a',],},],),)
			.toEqual({text, selects: [],},)
	})
})

describe('htmlSimpleFieldsToTokens', () => {
	it('converts inputs, textareas, and <br> but leaves selects untouched', () => {
		expect(
			htmlSimpleFieldsToTokens(
				'<input placeholder="x"><br><select id="r"><option>a</option></select>',
			),
		).toBe('{input: x}\n\n<select id="r"><option>a</option></select>',)
	})
})

describe('tokenToLegacyHtml / tokensToHtmlFields', () => {
	it('serializes each token kind to the legacy element', () => {
		expect(tokenToLegacyHtml({kind: 'input', id: 'x', placeholder: 'P', options: [],},),)
			.toBe('<input id="x" placeholder="P">',)
		expect(tokenToLegacyHtml({kind: 'textarea', placeholder: 'P "q"', options: [],},),)
			.toBe('<textarea placeholder="P &quot;q&quot;"></textarea>',)
		expect(tokenToLegacyHtml({kind: 'select', id: 's', placeholder: '', options: ['a', 'b',],},),)
			.toBe('<select id="s"><option>a</option><option>b</option></select>',)
	})

	it('expands a select reference from its definition and leaves the rest alone', () => {
		expect(
			tokensToHtmlFields('Pick {select:choice} then {author}', [{name: 'choice', options: ['a', 'b',],},],),
		).toBe('Pick <select id="choice"><option>a</option><option>b</option></select> then {author}',)
	})

	it('leaves an unresolved reference literal on the mirror', () => {
		expect(tokensToHtmlFields('Pick {select:missing}',),).toBe('Pick {select:missing}',)
	})

	it('round-trips legacy HTML through tokens and back', () => {
		const html = 'Pick: <select id="rule"><option>Rule 1</option><option>Rule 2</option></select>\n\n'
			+ 'Why: <input id="why" placeholder="reason">'
		const {text, selects,} = htmlFieldsToTokens(html,)
		expect(tokensToHtmlFields(text, selects,),).toBe(html,)
	})

	it('round-trips an id-less legacy select, gaining the generated id on the mirror', () => {
		const html = 'Pick: <select><option>a</option><option>b</option></select>'
		const {text, selects,} = htmlFieldsToTokens(html,)
		expect(tokensToHtmlFields(text, selects,),)
			.toBe('Pick: <select id="select-1"><option>a</option><option>b</option></select>',)
		// Re-converting the mirror yields the same definitions (reconcile converges).
		expect(htmlFieldsToTokens(tokensToHtmlFields(text, selects,),),).toEqual({text, selects,},)
	})

	it('escapes markdown link characters in option text for the v1 mirror, except )', () => {
		expect(
			tokensToHtmlFields('{select:r}', [
				{name: 'r', options: ['[See the rule.](https://example.com/rule)', 'b',],},
			],),
		).toBe(
			'<select id="r"><option>\\[See the rule.\\]\\(https://example.com/rule)</option><option>b</option></select>',
		)
	})

	it('does not double-escape already-escaped option text and drops a needless \\)', () => {
		expect(
			tokensToHtmlFields('{select:r}', [{name: 'r', options: ['a \\[rule\\]', 'b \\)',],},],),
		).toBe('<select id="r"><option>a \\[rule\\]</option><option>b )</option></select>',)
	})

	it('round-trips an option containing a markdown link through the v1 mirror', () => {
		const selects: SelectDefinition[] = [
			{name: 'r', options: ['**No slurs.** [See the rule.](https://example.com/rule)', 'Other',],},
		]
		const mirror = tokensToHtmlFields('{select:r}', selects,)
		expect(htmlFieldsToTokens(mirror,),).toEqual({text: '{select:r}', selects,},)
	})

	it('round-trips a select prompt through the label attribute', () => {
		const selects: SelectDefinition[] = [{name: 'r', prompt: 'Pick one', options: ['a', 'b',],},]
		const mirror = tokensToHtmlFields('{select:r}', selects,)
		expect(mirror,).toBe('<select id="r" label="Pick one"><option>a</option><option>b</option></select>',)
		expect(htmlFieldsToTokens(mirror,),).toEqual({text: '{select:r}', selects,},)
	})

	it('collapses multi-line option text on the legacy mirror', () => {
		expect(
			tokensToHtmlFields('{select:r}', [{name: 'r', options: ['line one\nline two',],},],),
		).toBe('<select id="r"><option>line one line two</option></select>',)
	})
})
