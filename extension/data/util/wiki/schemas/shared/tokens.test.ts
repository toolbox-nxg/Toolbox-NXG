/** Tests for the interactive token codec: parsing, serialization, and legacy HTML conversion. */

import {describe, expect, it,} from 'vitest'
import {
	canonicalizeChoiceBlocks,
	decodeHtmlAngleBrackets,
	htmlFieldsToTokens,
	htmlSimpleFieldsToTokens,
	inlineSelectDefinitions,
	type LegacySelectDefinition,
	parseReasonSegments,
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

	it('parses ids and textareas', () => {
		const segments = parseReasonSegments('{textarea#details: More details}',)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'textarea', id: 'details', placeholder: 'More details', options: [],},},
		],)
	})

	it('parses a choice block with an id, capturing the list below as options', () => {
		const segments = parseReasonSegments('{choice#rule}\n- Rule 1\n- Rule 2',)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'choice', id: 'rule', placeholder: '', options: ['Rule 1', 'Rule 2',],},},
		],)
	})

	it('parses an id-less choice block', () => {
		const segments = parseReasonSegments('{choice}\n- a\n- b',)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'choice', placeholder: '', options: ['a', 'b',],},},
		],)
	})

	it('keeps text before and after the block, ending options at the blank line', () => {
		const segments = parseReasonSegments('Pick a rule:\n\n{choice#r}\n- a\n- b\n\nThanks.',)
		expect(segments,).toEqual([
			{type: 'text', text: 'Pick a rule:\n\n',},
			{type: 'token', token: {kind: 'choice', id: 'r', placeholder: '', options: ['a', 'b',],},},
			{type: 'text', text: '\n\nThanks.',},
		],)
	})

	it('accepts *, +, and ordered list markers for options', () => {
		const segments = parseReasonSegments('{choice}\n* a\n+ b\n1. c\n2) d',)
		expect(segments[0],).toEqual(
			{type: 'token', token: {kind: 'choice', placeholder: '', options: ['a', 'b', 'c', 'd',],},},
		)
	})

	it('stops at the first non-list line', () => {
		const segments = parseReasonSegments('{choice}\n- a\n- b\nnot an option\n- c',)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'choice', placeholder: '', options: ['a', 'b',],},},
			{type: 'text', text: '\nnot an option\n- c',},
		],)
	})

	it('leaves a marker with no list line below it as literal text', () => {
		const segments = parseReasonSegments('{choice#rule}\n\n- a',)
		expect(segments,).toEqual([{type: 'text', text: '{choice#rule}\n\n- a',},],)
	})

	it('leaves an inline (not own-line) choice marker as literal text', () => {
		const segments = parseReasonSegments('Pick {choice#rule} now\n- a',)
		expect(segments,).toEqual([{type: 'text', text: 'Pick {choice#rule} now\n- a',},],)
	})

	it('leaves substitution tokens and unknown braces in the text', () => {
		const segments = parseReasonSegments('Hi {author}, removed from {subreddit}. {nonsense: x',)
		expect(segments,).toEqual([
			{type: 'text', text: 'Hi {author}, removed from {subreddit}. {nonsense: x',},
		],)
	})

	it('parses two choice blocks separated by text', () => {
		const segments = parseReasonSegments('{choice#a}\n- 1\n\nand\n\n{choice#b}\n- 2',)
		expect(segments.filter((s,) => s.type === 'token'),).toEqual([
			{type: 'token', token: {kind: 'choice', id: 'a', placeholder: '', options: ['1',],},},
			{type: 'token', token: {kind: 'choice', id: 'b', placeholder: '', options: ['2',],},},
		],)
	})
})

describe('serializeToken', () => {
	it('round-trips inline tokens through parseReasonSegments', () => {
		const text = '{input#flight: Flight number} and {textarea: Notes}'
		const reserialized = parseReasonSegments(text,)
			.map((s,) => s.type === 'text' ? s.text : serializeToken(s.token,))
			.join('',)
		expect(reserialized,).toBe(text,)
	})

	it('sanitizes braces that would break the syntax', () => {
		expect(serializeToken({kind: 'input', placeholder: 'a {b} c', options: [],},),)
			.toBe('{input: a (b) c}',)
	})

	it('serializes a choice to its marker-and-list block', () => {
		const token = {kind: 'choice' as const, id: 'rule', placeholder: '', options: ['a', 'b',],}
		expect(serializeToken(token,),).toBe('{choice#rule}\n- a\n- b',)
	})
})

describe('canonicalizeChoiceBlocks', () => {
	it('surrounds a block with exactly one blank line and is idempotent', () => {
		const messy = 'Heading\n{choice#r}\n- a\n- b\nBody'
		const canonical = 'Heading\n\n{choice#r}\n- a\n- b\n\nBody'
		expect(canonicalizeChoiceBlocks(messy,),).toBe(canonical,)
		expect(canonicalizeChoiceBlocks(canonical,),).toBe(canonical,)
	})

	it('leaves text with no choice block untouched', () => {
		const text = 'Just {input: why} and a\n\n\ntriple gap'
		expect(canonicalizeChoiceBlocks(text,),).toBe(text,)
	})
})

describe('substituteTokenValues', () => {
	it('replaces tokens with values in document order', () => {
		const text = 'Pick:\n\n{choice}\n- a\n- b\n\nwrite {input: x}, done'
		expect(substituteTokenValues(text, ['B', 'hello',],),).toBe('Pick:\n\nB\n\nwrite hello, done',)
	})

	it('uses empty string for missing values and keeps substitution tokens', () => {
		expect(substituteTokenValues('{input: x} {author}', [],),).toBe(' {author}',)
	})
})

describe('htmlFieldsToTokens', () => {
	it('rewrites a select with an id into an inline choice block', () => {
		const html = 'Pick: <select id="rule"><option>Rule 1</option><option>Rule 2</option></select>'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(html,),),)
			.toBe('Pick:\n\n{choice#rule}\n- Rule 1\n- Rule 2',)
	})

	it('drops a missing or non-slug-safe id to a bare choice', () => {
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens('<select><option>a</option></select>',),),)
			.toBe('{choice}\n- a',)
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens('<select id="not valid!"><option>a</option></select>',),),)
			.toBe('{choice}\n- a',)
	})

	it('turns a label attribute into a markdown line above the block', () => {
		const html = '<select id="r" label="Pick one"><option>a</option></select>'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(html,),),)
			.toBe('Pick one\n\n{choice#r}\n- a',)
	})

	it('prefers an explicit option value attribute over the text', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens('<select><option value="short">A much longer label</option></select>',),
		),).toBe('{choice}\n- short',)
	})

	it('recovers the trailing ) of a markdown link inside an option', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens('<select><option>[see rules](https://example.com/rules\\))</option></select>',),
		),).toBe('{choice}\n- [see rules](https://example.com/rules)',)
	})

	it('tolerates a misspelled </option> closer without merging options', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens('<select><option>Rule 1</optiom><option>Rule 2</option></select>',),
		),).toBe('{choice}\n- Rule 1\n- Rule 2',)
	})

	it('strips v1 markdown escapes from option text so links render in token form', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens(
				'<select><option>**No slurs.** \\[See the rule.\\]\\(https://example.com/rule\\)</option></select>',
			),
		),).toBe('{choice}\n- **No slurs.** [See the rule.](https://example.com/rule)',)
	})

	it('converts inputs and textareas with id and placeholder', () => {
		expect(htmlFieldsToTokens('<input id="num" placeholder="Flight number">',),)
			.toBe('{input#num: Flight number}',)
		expect(htmlFieldsToTokens('<textarea id="why" placeholder="Tell us why"></textarea>',),)
			.toBe('{textarea#why: Tell us why}',)
	})

	it('uses textarea inner text as the placeholder fallback', () => {
		expect(htmlFieldsToTokens('<textarea>Enter Custom reason</textarea>',),)
			.toBe('{textarea: Enter Custom reason}',)
	})

	it('converts <br> variants to paragraph breaks', () => {
		expect(htmlFieldsToTokens('one<br>two<br/>three<br />four',),)
			.toBe('one\n\ntwo\n\nthree\n\nfour',)
	})

	it('passes token-form and plain text through unchanged', () => {
		const text = 'Hi {author}, {input: reason} — *markdown* stays'
		expect(htmlFieldsToTokens(text,),).toBe(text,)
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

describe('inlineSelectDefinitions', () => {
	it('rewrites a {select:name} reference into an inline choice block from its definition', () => {
		const selects: LegacySelectDefinition[] = [{name: 'rule', options: ['Rule 1', 'Rule 2',],},]
		expect(canonicalizeChoiceBlocks(inlineSelectDefinitions('Pick {select:rule} please', selects,),),)
			.toBe('Pick\n\n{choice#rule}\n- Rule 1\n- Rule 2\n\nplease',)
	})

	it('puts the definition prompt above the marker', () => {
		const selects: LegacySelectDefinition[] = [{name: 'r', prompt: 'Which rule?', options: ['a',],},]
		expect(canonicalizeChoiceBlocks(inlineSelectDefinitions('{select:r}', selects,),),)
			.toBe('Which rule?\n\n{choice#r}\n- a',)
	})

	it('leaves a reference with no matching (or empty) definition untouched', () => {
		expect(inlineSelectDefinitions('Pick {select:missing}', [{name: 'other', options: ['a',],},],),)
			.toBe('Pick {select:missing}',)
		expect(inlineSelectDefinitions('Pick {select:r}', [{name: 'r', options: [],},],),)
			.toBe('Pick {select:r}',)
	})
})

describe('tokenToLegacyHtml / tokensToHtmlFields', () => {
	it('serializes each token kind to the legacy element', () => {
		expect(tokenToLegacyHtml({kind: 'input', id: 'x', placeholder: 'P', options: [],},),)
			.toBe('<input id="x" placeholder="P">',)
		expect(tokenToLegacyHtml({kind: 'textarea', placeholder: 'P "q"', options: [],},),)
			.toBe('<textarea placeholder="P &quot;q&quot;"></textarea>',)
		expect(tokenToLegacyHtml({kind: 'choice', id: 's', placeholder: '', options: ['a', 'b',],},),)
			.toBe('<select id="s"><option>a</option><option>b</option></select>',)
	})

	it('expands a choice block into a <select> and leaves the rest alone', () => {
		expect(tokensToHtmlFields('Pick:\n\n{choice#choice}\n- a\n- b\n\nthen {author}',),)
			.toBe('Pick:\n\n<select id="choice"><option>a</option><option>b</option></select>\n\nthen {author}',)
	})

	it('round-trips a canonical choice block through the legacy mirror and back', () => {
		const text = 'Pick:\n\n{choice#rule}\n- Rule 1\n- Rule 2\n\nWhy: {input#why: reason}'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(tokensToHtmlFields(text,),),),).toBe(text,)
	})

	it('round-trips an id-less choice block', () => {
		const text = '{choice}\n- a\n- b'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(tokensToHtmlFields(text,),),),).toBe(text,)
	})

	it('escapes markdown link characters in option text for the v1 mirror, except )', () => {
		expect(
			tokensToHtmlFields('{choice#r}\n- [See the rule.](https://example.com/rule)\n- b',),
		).toBe(
			'<select id="r"><option>\\[See the rule.\\]\\(https://example.com/rule)</option><option>b</option></select>',
		)
	})

	it('round-trips an option containing a markdown link through the v1 mirror', () => {
		const text = '{choice#r}\n- **No slurs.** [See the rule.](https://example.com/rule)\n- Other'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(tokensToHtmlFields(text,),),),).toBe(text,)
	})

	it('collapses multi-line option text on the legacy mirror', () => {
		expect(tokenToLegacyHtml({kind: 'choice', id: 'r', placeholder: '', options: ['line one\nline two',],},),)
			.toBe('<select id="r"><option>line one line two</option></select>',)
	})
})
