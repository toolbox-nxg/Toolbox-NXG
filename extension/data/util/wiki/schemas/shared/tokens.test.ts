/** Tests for the interactive token codec: parsing, serialization, and legacy HTML conversion. */

import {describe, expect, it,} from 'vitest'
import {
	canonicalizeChoiceBlocks,
	decodeHtmlAngleBrackets,
	decodeTicks,
	demoteToggles,
	emphasize,
	encodeTicks,
	findLiteralFieldMarker,
	findUnfilledRequired,
	htmlFieldsToTokens,
	htmlSimpleFieldsToTokens,
	ignoreFieldStyle,
	inlineSelectDefinitions,
	type InteractiveToken,
	type LegacySelectDefinition,
	parseReasonSegments,
	promoteLegacyToggles,
	renderToggleValue,
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

	it('parses a block whose list is separated from the marker by a blank line', () => {
		// The markdown-natural way to write it. Treating it as "not a choice" sent the marker
		// and every option to the removed user instead of the one the moderator picked.
		const segments = parseReasonSegments('Pick a rule:\n\n{choice#r}\n\n- a\n- b\n\nThanks.',)
		expect(segments,).toEqual([
			{type: 'text', text: 'Pick a rule:\n\n',},
			{type: 'token', token: {kind: 'choice', id: 'r', placeholder: '', options: ['a', 'b',],},},
			{type: 'text', text: '\n\nThanks.',},
		],)
	})

	it('skips several blank lines between the marker and its list', () => {
		const segments = parseReasonSegments('{choice}\n \n\n- a\n- b',)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'choice', placeholder: '', options: ['a', 'b',],},},
		],)
	})

	it('leaves a marker whose next non-blank line is not a list item as literal text', () => {
		const segments = parseReasonSegments('{choice#rule}\n\nJust some text\n\n- a',)
		expect(segments,).toEqual([{type: 'text', text: '{choice#rule}\n\nJust some text\n\n- a',},],)
	})

	it('leaves a marker with nothing below it as literal text', () => {
		const segments = parseReasonSegments('{choice#rule}\n\n',)
		expect(segments,).toEqual([{type: 'text', text: '{choice#rule}\n\n',},],)
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

	it('keeps a blank leading option instead of ending the block (issue #22)', () => {
		const segments = parseReasonSegments('{choice#r}\n- \n- Rule 1\n- Rule 2',)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'choice', id: 'r', placeholder: '', options: ['', 'Rule 1', 'Rule 2',],},},
		],)
	})

	it('reads a bare bullet with no trailing space as a blank option', () => {
		const segments = parseReasonSegments('{choice#r}\n- a\n-',)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'choice', id: 'r', placeholder: '', options: ['a', '',],},},
		],)
	})

	it('still ends the block at a bullet glued to its text', () => {
		const segments = parseReasonSegments('{choice}\n- a\n-notanoption',)
		expect(segments,).toEqual([
			{type: 'token', token: {kind: 'choice', placeholder: '', options: ['a',],},},
			{type: 'text', text: '\n-notanoption',},
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

	it('stays idempotent for a block whose last option is blank', () => {
		// The blank-option line loses its trailing space to the blank-line collapse, so
		// the bare bullet it leaves behind has to re-parse as the same blank option.
		const once = canonicalizeChoiceBlocks(
			htmlFieldsToTokens('<select id="r"><option>a</option><option></option></select>',),
		)
		expect(once,).toBe('{dropdown#r}\n- a\n-',)
		expect(canonicalizeChoiceBlocks(once,),).toBe(once,)
	})

	it('tightens a block whose list sat below a blank line, so configs heal on save', () => {
		const loose = 'Heading\n\n{choice#r}\n\n- a\n- b\n\nBody'
		const canonical = 'Heading\n\n{choice#r}\n- a\n- b\n\nBody'
		expect(canonicalizeChoiceBlocks(loose,),).toBe(canonical,)
		expect(canonicalizeChoiceBlocks(canonical,),).toBe(canonical,)
	})

	it('keeps the indentation of a line after a blank line, so list continuations survive', () => {
		// Indented paragraphs continue the list item above; an indented `- ` is a sub-list.
		const text = '- All fanart must {highlight: have a source}.\n\n  {highlight: Non-original} must.\n\n'
			+ '  [Read the rules](https://x) first.\n\n - {highlight: sub item}'
		expect(canonicalizeChoiceBlocks(text,),).toBe(text,)
	})

	it('collapses a gap holding whitespace-only lines to one blank line', () => {
		expect(canonicalizeChoiceBlocks('Heading  \n\n \t\n\n{choice#r}\n- a\n- b\n\n  Body',),).toBe(
			'Heading\n\n{choice#r}\n- a\n- b\n\n  Body',
		)
	})

	it('leaves text with no choice block untouched', () => {
		const text = 'Just {input: why} and a\n\n\ntriple gap'
		expect(canonicalizeChoiceBlocks(text,),).toBe(text,)
	})
})

describe('findLiteralFieldMarker', () => {
	it('is null for a block that parses, tight or with a blank line before the list', () => {
		expect(findLiteralFieldMarker('{choice#r}\n- a\n- b',),).toBeNull()
		expect(findLiteralFieldMarker('Pick:\n\n{choice}\n\n- a\n- b\n',),).toBeNull()
	})

	it('is null for text with no choice marker at all', () => {
		expect(findLiteralFieldMarker('Hi {author}, see {input: why}',),).toBeNull()
	})

	it('reports a marker with no option list under it as no-options', () => {
		expect(findLiteralFieldMarker('{choice#rule}\n\nJust some text',)?.problem,).toBe('no-options',)
		expect(findLiteralFieldMarker('{choice}',)?.problem,).toBe('no-options',)
	})

	it('reports a marker written inline in a sentence as inline', () => {
		expect(findLiteralFieldMarker('Pick {choice#rule} now\n- a\n- b',)?.problem,).toBe('inline',)
	})

	it('reports the problem when only one of two markers parsed', () => {
		expect(findLiteralFieldMarker('{choice#a}\n- a\n\n{choice#b}\n\nnot a list',)?.problem,).toBe('no-options',)
		// The parsed block must not make the later inline marker look like an own-line one.
		expect(findLiteralFieldMarker('{choice#a}\n- a\n\nPick {choice#b} now',)?.problem,).toBe('inline',)
	})

	it('does not read an option that mentions {choice} as a second marker', () => {
		expect(findLiteralFieldMarker('{choice}\n- fill in the {choice} field\n- b',),).toBeNull()
	})

	it('classifies off the whole line, not the segment an inline token splits', () => {
		// `{input}` sits on the marker's line, so the marker never starts a block: the fix is
		// moving it to its own line, not adding a list.
		expect(findLiteralFieldMarker('{input: why} {choice}\n- a\n- b',)?.problem,).toBe('inline',)
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
	it('rewrites a select with an id on its own line into a dropdown block', () => {
		const html = 'Pick:\n<select id="rule"><option>Rule 1</option><option>Rule 2</option></select>'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(html,),),)
			.toBe('Pick:\n\n{dropdown#rule}\n- Rule 1\n- Rule 2',)
	})

	it('keeps a select that shares its line with text inline, in place', () => {
		const html = 'This is a <select id="rule"><option>repost</option><option>spam</option></select> post.'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(html,),),)
			.toBe('This is a {dropdown#rule: repost | spam} post.',)
	})

	it('keeps a select used as link text inside the link', () => {
		const html = 'This is a [<select><option>repost</option><option>spam</option></select>](https://example.com).'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(html,),),)
			.toBe('This is a [{dropdown: repost | spam}](https://example.com).',)
	})

	it('keeps inline an option that is itself a link, escaping a literal pipe', () => {
		const html =
			'See <select><option>\\[the rules\\]\\(https://example.com\\)</option><option>a|b</option></select>'
		expect(htmlFieldsToTokens(html,),).toBe('See {dropdown: [the rules](https://example.com) | a\\|b}',)
	})

	it('round-trips an inline select through the token form, marking it a dropdown', () => {
		const html = 'This is a <select id="r"><option>repost</option><option>spam</option></select> post.'
		const marked =
			'This is a <select id="r" data-tbx-dropdown="1"><option>repost</option><option>spam</option></select> post.'
		expect(tokensToHtmlFields(htmlFieldsToTokens(html,),),).toBe(marked,)
		expect(tokensToHtmlFields(htmlFieldsToTokens(marked,),),).toBe(marked,)
	})

	it('reads a select marked data-tbx-choice back as a choice', () => {
		expect(
			htmlFieldsToTokens(
				'Pick <select id="r" data-tbx-choice="1"><option>a</option><option>b</option></select>',
			),
		)
			.toBe('Pick {choice#r: a | b}',)
	})

	it('keeps an unmarked inline faked tick box a choice, so it can be promoted', () => {
		expect(htmlFieldsToTokens('- <select><option>a</option><option>**a**</option></select>',),)
			.toBe('- {choice: a | **a**}',)
	})

	it('drops a missing or non-slug-safe id to a bare dropdown', () => {
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens('<select><option>a</option></select>',),),)
			.toBe('{dropdown}\n- a',)
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens('<select id="not valid!"><option>a</option></select>',),),)
			.toBe('{dropdown}\n- a',)
	})

	it('turns a label attribute into a markdown line above the block', () => {
		const html = '<select id="r" label="Pick one"><option>a</option></select>'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(html,),),)
			.toBe('Pick one\n\n{dropdown#r}\n- a',)
	})

	it('prefers an explicit option value attribute over the text', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens('<select><option value="short">A much longer label</option></select>',),
		),).toBe('{dropdown}\n- short',)
	})

	it('recovers the trailing ) of a markdown link inside an option', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens('<select><option>[see rules](https://example.com/rules\\))</option></select>',),
		),).toBe('{dropdown}\n- [see rules](https://example.com/rules)',)
	})

	it('tolerates a misspelled </option> closer without merging options', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens('<select><option>Rule 1</optiom><option>Rule 2</option></select>',),
		),).toBe('{dropdown}\n- Rule 1\n- Rule 2',)
	})

	it('strips v1 markdown escapes from option text so links render in token form', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens(
				'<select><option>**No slurs.** \\[See the rule.\\]\\(https://example.com/rule\\)</option></select>',
			),
		),).toBe('{dropdown}\n- **No slurs.** [See the rule.](https://example.com/rule)',)
	})

	it('keeps a blank placeholder <option> as a blank dropdown option', () => {
		expect(canonicalizeChoiceBlocks(
			htmlFieldsToTokens('<select id="r"><option></option><option>Rule 1</option></select>',),
		),).toBe('{dropdown#r}\n- \n- Rule 1',)
	})

	it('converts every select when an earlier one opens with a blank option (issue #22)', () => {
		const html = '<select id="a"><option>A1</option><option>A2</option></select>'
			+ '<select id="b"><option></option><option>B1</option></select>'
			+ '<select id="c"><option></option><option>C1</option></select>'
		const tokens = parseReasonSegments(htmlFieldsToTokens(html,),)
			.flatMap((s,) => s.type === 'token' ? [s.token,] : [])
		expect(tokens,).toEqual([
			{kind: 'choice', dropdown: true, id: 'a', placeholder: '', options: ['A1', 'A2',],},
			{kind: 'choice', dropdown: true, id: 'b', placeholder: '', options: ['', 'B1',],},
			{kind: 'choice', dropdown: true, id: 'c', placeholder: '', options: ['', 'C1',],},
		],)
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
			.toBe('<select id="s" data-tbx-choice="1"><option>a</option><option>b</option></select>',)
	})

	it('expands a choice block into a <select> and leaves the rest alone', () => {
		expect(tokensToHtmlFields('Pick:\n\n{choice#choice}\n- a\n- b\n\nthen {author}',),)
			.toBe(
				'Pick:\n\n<select id="choice" data-tbx-choice="1"><option>a</option><option>b</option></select>\n\nthen {author}',
			)
	})

	it('expands a block whose list sat below a blank line into a single <select>', () => {
		expect(tokensToHtmlFields('Pick:\n\n{choice#choice}\n\n- a\n- b\n\nthen {author}',),)
			.toBe(
				'Pick:\n\n<select id="choice" data-tbx-choice="1"><option>a</option><option>b</option></select>\n\nthen {author}',
			)
	})

	it('round-trips a canonical choice block through the legacy mirror and back', () => {
		const text = 'Pick:\n\n{choice#rule}\n- Rule 1\n- Rule 2\n\nWhy: {input#why: reason}'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(tokensToHtmlFields(text,),),),).toBe(text,)
	})

	it('round-trips an id-less choice block', () => {
		const text = '{choice}\n- a\n- b'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(tokensToHtmlFields(text,),),),).toBe(text,)
	})

	it('round-trips a blank option through the legacy mirror', () => {
		const text = '{choice#r}\n- \n- a'
		expect(tokensToHtmlFields(text,),)
			.toBe('<select id="r" data-tbx-choice="1"><option></option><option>a</option></select>',)
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(tokensToHtmlFields(text,),),),).toBe(text,)
	})

	it('escapes markdown link characters in option text for the v1 mirror, except )', () => {
		expect(
			tokensToHtmlFields('{choice#r}\n- [See the rule.](https://example.com/rule)\n- b',),
		).toBe(
			'<select id="r" data-tbx-choice="1"><option>\\[See the rule.\\]\\(https://example.com/rule)</option><option>b</option></select>',
		)
	})

	it('round-trips an option containing a markdown link through the v1 mirror', () => {
		const text = '{choice#r}\n- **No slurs.** [See the rule.](https://example.com/rule)\n- Other'
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(tokensToHtmlFields(text,),),),).toBe(text,)
	})

	it('collapses multi-line option text on the legacy mirror', () => {
		expect(tokenToLegacyHtml({kind: 'choice', id: 'r', placeholder: '', options: ['line one\nline two',],},),)
			.toBe('<select id="r" data-tbx-choice="1"><option>line one line two</option></select>',)
	})
})

describe('inline choice tokens', () => {
	it('parses options split on unescaped pipes, with an optional id', () => {
		expect(parseReasonSegments('a {choice#r: one | two \\| three} b',),).toEqual([
			{type: 'text', text: 'a ',},
			{
				type: 'token',
				token: {kind: 'choice', id: 'r', placeholder: '', options: ['one', 'two | three',], inline: true,},
			},
			{type: 'text', text: ' b',},
		],)
	})

	it('leaves a choice with no option text literal', () => {
		expect(parseReasonSegments('a {choice: } b',),).toEqual([{type: 'text', text: 'a {choice: } b',},],)
		expect(parseReasonSegments('a {choice: | } b',),).toEqual([{type: 'text', text: 'a {choice: | } b',},],)
	})

	it('serializes back to the same text', () => {
		const text = 'a {choice#r: one | two \\| three} b'
		const [, token,] = parseReasonSegments(text,)
		expect(token?.type === 'token' && serializeToken(token.token,),).toBe('{choice#r: one | two \\| three}',)
	})

	it('substitutes the picked value in place, keeping surrounding markdown intact', () => {
		expect(substituteTokenValues('This is a [{choice: repost | spam}](https://x) post.', ['repost',],),)
			.toBe('This is a [repost](https://x) post.',)
	})

	it('canonicalizes option spacing and is idempotent', () => {
		const once = canonicalizeChoiceBlocks('a {choice:one|two} b',)
		expect(once,).toBe('a {choice: one | two} b',)
		expect(canonicalizeChoiceBlocks(once,),).toBe(once,)
	})

	it('down-converts to a select in place', () => {
		expect(tokensToHtmlFields('a {choice#r: one | two} b',),)
			.toBe('a <select id="r" data-tbx-choice="1"><option>one</option><option>two</option></select> b',)
	})

	it('is not reported as a literal choice marker', () => {
		expect(findLiteralFieldMarker('a {choice: one | two} b',),).toBeNull()
	})
})

describe('tick-box fields', () => {
	const imageRule = [
		'Image posts must:',
		'',
		'{highlight#imagerules}',
		'- [ ] be original content you created',
		'- [x] include the source in the title',
		'',
		'See the rules.',
	].join('\n',)

	/** The token of the segment at `index`, failing the test when it is text. */
	const tokenAt = (text: string, index: number,): InteractiveToken => {
		const segment = parseReasonSegments(text,)[index]
		if (segment?.type !== 'token') { throw new Error(`no token at ${index}`,) }
		return segment.token
	}

	it('parses a {highlight} block with its starting ticks', () => {
		expect(tokenAt(imageRule, 1,),).toEqual({
			kind: 'highlight',
			id: 'imagerules',
			placeholder: '',
			options: ['be original content you created', 'include the source in the title',],
			checked: [false, true,],
		},)
	})

	it('parses a {multi} block, accepting any bullet and an upper-case X', () => {
		expect(parseReasonSegments('{multi}\n* [X] a\n+ [ ] b\n1. [ ] c',),).toEqual([{
			type: 'token',
			token: {kind: 'multi', placeholder: '', options: ['a', 'b', 'c',], checked: [true, false, false,],},
		},],)
	})

	it('ends a tick-box block at the first plain item, and a choice block at the first task item', () => {
		expect(parseReasonSegments('{multi}\n- [ ] a\n- b',).map((segment,) => segment.type),).toEqual([
			'token',
			'text',
		],)
		expect(tokenAt('{choice}\n- a\n- [ ] b', 0,),).toMatchObject({kind: 'choice', options: ['a',],},)
	})

	it('leaves a marker whose list is the other style literal', () => {
		expect(parseReasonSegments('{multi}\n- a\n- b',),).toEqual([{type: 'text', text: '{multi}\n- a\n- b',},],)
		expect(parseReasonSegments('{choice}\n- [ ] a',),).toEqual([{type: 'text', text: '{choice}\n- [ ] a',},],)
	})

	it('parses inline {check} and {highlight} boxes, with an optional leading [x]', () => {
		expect(parseReasonSegments('a {check: [x] spam} b {highlight#h: rule 1} c',),).toEqual([
			{type: 'text', text: 'a ',},
			{
				type: 'token',
				token: {kind: 'multi', placeholder: '', options: ['spam',], checked: [true,], inline: true,},
			},
			{type: 'text', text: ' b ',},
			{
				type: 'token',
				token: {
					kind: 'highlight',
					id: 'h',
					placeholder: '',
					options: ['rule 1',],
					checked: [false,],
					inline: true,
				},
			},
			{type: 'text', text: ' c',},
		],)
	})

	it('does not read a link written as the text as a tick box', () => {
		expect(tokenAt('a {check: [x](https://example.com) b} c', 1,),)
			.toMatchObject({options: ['[x](https://example.com) b',], checked: [false,],},)
	})

	it('leaves an inline box with no text literal', () => {
		expect(parseReasonSegments('a {check: [x] } b',),).toEqual([{type: 'text', text: 'a {check: [x] } b',},],)
	})

	it('round-trips blocks and inline boxes through serialization', () => {
		const text = '{multi#m}\n- [x] a\n- [ ] b'
		expect(canonicalizeChoiceBlocks(text,),).toBe(text,)
		expect(canonicalizeChoiceBlocks('x {highlight: [ ] a} y {check: [X] b}',),)
			.toBe('x {highlight: a} y {check: [x] b}',)
	})

	it('keeps the [ ] on an unticked inline box whose text would otherwise re-parse as ticked', () => {
		const token: InteractiveToken = {
			kind: 'multi',
			placeholder: '',
			options: ['[x] a',],
			checked: [false,],
			inline: true,
		}
		expect(serializeToken(token,),).toBe('{check: [ ] [x] a}',)
	})

	it('canonicalizes a loose block to the tight form', () => {
		expect(canonicalizeChoiceBlocks('Intro\n{highlight}\n\n*  [X] a\n- [ ] b\nOutro',),)
			.toBe('Intro\n\n{highlight}\n- [x] a\n- [ ] b\n\nOutro',)
	})

	it('encodes and decodes tick state, ignoring stale values', () => {
		expect(encodeTicks([true, false, true,],),).toBe('0,2',)
		expect(encodeTicks([false,],),).toBe('',)
		expect(decodeTicks('0,2', 3,),).toEqual([true, false, true,],)
		expect(decodeTicks('be between 10 seconds', 2,),).toEqual([false, false,],)
		expect(decodeTicks('1,7', 2,),).toEqual([false, true,],)
	})

	it('bolds with ** unless the text already holds **', () => {
		expect(emphasize('a',),).toBe('**a**',)
		expect(emphasize('a **b** c',),).toBe('__a **b** c__',)
	})

	it('renders each kind for a tick state', () => {
		expect(renderToggleValue(tokenAt(imageRule, 1,), [true, false,],),)
			.toBe('- **be original content you created**\n- include the source in the title',)

		const multi = tokenAt('{multi}\n- [ ] a\n- [ ] b\n- [ ] c', 0,)
		expect(renderToggleValue(multi, [true, false, true,],),).toBe('- a\n- c',)
		expect(renderToggleValue(multi, [],),).toBe('',)
	})

	it('substitutes tick state, falling back to the template ticks when no value was collected', () => {
		const text = 'Pick:\n\n{multi}\n- [x] a\n- [ ] b\n\nand {highlight: c} and {check: d}.'
		expect(substituteTokenValues(text, ['1', '0', '',],),).toBe('Pick:\n\n- b\n\nand **c** and .',)
		expect(substituteTokenValues(text, [],),).toBe('Pick:\n\n- a\n\nand c and .',)
	})

	it('reports markers that will be sent as text', () => {
		expect(findLiteralFieldMarker('{multi}\n- [ ] a',),).toBeNull()
		expect(findLiteralFieldMarker('Pick {highlight} now\n- [ ] a',),).toEqual({
			kind: 'highlight',
			problem: 'inline',
		},)
		expect(findLiteralFieldMarker('{multi}\n\nno list',),).toEqual({kind: 'multi', problem: 'no-options',},)
		expect(findLiteralFieldMarker('{multi}\n- a',),).toEqual({kind: 'multi', problem: 'wrong-list',},)
		expect(findLiteralFieldMarker('{choice}\n- [ ] a',),).toEqual({kind: 'choice', problem: 'wrong-list',},)
		expect(findLiteralFieldMarker('a {highlight: b} c',),).toBeNull()
	})

	it('down-converts each item to a <select> of its two outputs, ticked output first', () => {
		expect(tokensToHtmlFields('{highlight#r}\n- [ ] a\n- [x] b',),).toBe(
			'- <select data-tbx-choice="1"><option>a</option><option>**a**</option></select>\n'
				+ '- <select data-tbx-choice="1"><option>**b**</option><option>b</option></select>',
		)
		expect(tokensToHtmlFields('x {check#c: y} z',),).toBe(
			'x <select id="c" data-tbx-choice="1"><option></option><option>y</option></select> z',
		)
	})

	it('comes back from the v1 mirror as the same boxes, in the inline form', () => {
		const text = 'Image posts must:\n\n{highlight}\n- [ ] a\n- [x] b\n\n{multi}\n- [ ] c'
		const roundTripped = canonicalizeChoiceBlocks(
			promoteLegacyToggles(htmlFieldsToTokens(tokensToHtmlFields(text,),),),
		)
		expect(roundTripped,).toBe('Image posts must:\n\n- {highlight: a}\n- {highlight: [x] b}\n\n- {check: c}',)
		// The same message goes out either way.
		expect(substituteTokenValues(roundTripped, ['0', '', '0',],),)
			.toBe(substituteTokenValues(text, ['0', '0',],),)
	})

	it('promotes a hand-written fake highlight from 6.x, keeping the rest of the text as written', () => {
		const legacy = [
			'- Image posts must meet the following rules',
			'',
			'- {choice: be original | **be original**}',
			'',
			'- {choice#t: **cite the source** | cite the source}. Wait a week.',
			'',
			'- {choice: | posted too often}',
			'',
			'- {choice: a | b}',
		].join('\n',)
		expect(promoteLegacyToggles(legacy,),).toBe([
			'- Image posts must meet the following rules',
			'',
			'- {highlight: be original}',
			'',
			'- {highlight#t: [x] cite the source}. Wait a week.',
			'',
			'- {check: posted too often}',
			'',
			'- {choice: a | b}',
		].join('\n',),)
		// A block choice picks a paragraph, not a list item, so it is left alone.
		expect(promoteLegacyToggles('{choice}\n- a\n- **a**',),).toBe('{choice}\n- a\n- **a**',)
	})

	it('demotes boxes back to the inline choices they stand for', () => {
		expect(demoteToggles('- {highlight#t: [x] a}. b',),).toBe('- {choice#t: **a** | a}. b',)
		expect(demoteToggles('x\n\n{multi}\n- [ ] a\n- [x] b\n\ny',),)
			.toBe('x\n\n- {choice:  | a}\n- {choice: b | }\n\ny',)
		expect(promoteLegacyToggles(demoteToggles('- {highlight: a}\n- {check: [x] b}',),),)
			.toBe('- {highlight: a}\n- {check: [x] b}',)
	})
})

describe('{note} tokens', () => {
	it('parses an inline note as moderator text', () => {
		expect(parseReasonSegments('Rule 5 {note: only for image posts} applies.',),).toEqual([
			{type: 'text', text: 'Rule 5 ',},
			{type: 'token', token: {kind: 'note', placeholder: 'only for image posts', options: [],},},
			{type: 'text', text: ' applies.',},
		],)
	})

	it('leaves an empty note literal and ignores a required mark on one', () => {
		expect(parseReasonSegments('a {note:} b',),).toEqual([{type: 'text', text: 'a {note:} b',},],)
		expect(parseReasonSegments('{note!: x}',)[0],).toEqual({
			type: 'token',
			token: {kind: 'note', placeholder: 'x', options: [],},
		},)
	})

	it('sends nothing and takes no value slot', () => {
		expect(substituteTokenValues('{note: check flair} Why: {input: why}', ['because',],),).toBe(' Why: because',)
	})

	it('round-trips through the v1 mirror as a reserved-id input', () => {
		const text = 'Rule 5 {note: say "only images"} applies.'
		const legacy = tokensToHtmlFields(text,)
		expect(legacy,).toBe('Rule 5 <input id="tbx-note" placeholder="say &quot;only images&quot;"> applies.',)
		expect(htmlFieldsToTokens(legacy,),).toBe(text,)
	})
})

describe('required fields', () => {
	it('parses ! on inline tokens and block markers, after any id', () => {
		const segments = parseReasonSegments(
			'{input#why!: why} {check!: spam}\n\n{choice#r!}\n- a\n\n{multi!}\n- [ ] b',
		)
		const tokens = segments.flatMap((segment,) => segment.type === 'token' ? [segment.token,] : [])
		expect(tokens.map((token,) => [token.kind, token.id, token.required,]),).toEqual([
			['input', 'why', true,],
			['multi', undefined, true,],
			['choice', 'r', true,],
			['multi', undefined, true,],
		],)
	})

	it('serializes the mark back in place', () => {
		const text = '{input#why!: why} {check!: [x] spam}\n\n{choice#r!}\n- a\n\n{highlight!}\n- [ ] b'
		expect(canonicalizeChoiceBlocks(text,),).toBe(text,)
	})

	it('flags a required marker that will be sent as text', () => {
		expect(findLiteralFieldMarker('Pick {choice!} now\n- a',),).toEqual({kind: 'choice', problem: 'inline',},)
		expect(findLiteralFieldMarker('{multi!}\n- a',),).toEqual({kind: 'multi', problem: 'wrong-list',},)
	})

	it('finds unfilled required fields by control position', () => {
		const text = [
			'{note: not a control}',
			'{input!: why}',
			'{input: optional}',
			'',
			'{choice!}',
			'- ',
			'- Rule 1',
			'',
			'{multi!}',
			'- [ ] a',
			'- [ ] b',
		].join('\n',)
		// Blank text, the blank "nothing picked" option, and no ticks are all unfilled.
		expect(findUnfilledRequired(text, ['  ', '', '', '',],),).toEqual([0, 2, 3,],)
		expect(findUnfilledRequired(text, ['x', '', 'Rule 1', '1',],),).toEqual([],)
		// No collected values: the template's starting state decides.
		expect(findUnfilledRequired('{check!: [x] a} {choice!: b | c}', [],),).toEqual([],)
	})

	it('round-trips through the v1 mirror as a required attribute', () => {
		const text = 'Why: {input#why!: why}. Pick {choice!: a | b}. {highlight!: c}'
		const legacy = tokensToHtmlFields(text,)
		expect(legacy,).toContain('<input id="why" required="required" placeholder="why">',)
		expect(legacy,).toContain('<select required="required" data-tbx-choice="1"><option>a</option>',)
		expect(promoteLegacyToggles(htmlFieldsToTokens(legacy,),),).toBe(text,)
		// A bare 6.x-style attribute reads the same.
		expect(htmlFieldsToTokens('<input required placeholder="x">',),).toBe('{input!: x}',)
	})

	it('drops the required mark of a block tick box from its per-item mirror selects', () => {
		expect(tokensToHtmlFields('{multi!}\n- [ ] a',),).toBe(
			'- <select data-tbx-choice="1"><option></option><option>a</option></select>',
		)
	})
})

describe('{dropdown}', () => {
	it('parses a block as a choice shown as a dropdown, keeping id and required mark', () => {
		const [segment,] = parseReasonSegments('{dropdown#rule!}\n- Rule 1\n- Rule 2',)
		expect(segment,).toEqual({
			type: 'token',
			token: {
				kind: 'choice',
				placeholder: '',
				options: ['Rule 1', 'Rule 2',],
				dropdown: true,
				id: 'rule',
				required: true,
			},
		},)
	})

	it('parses the inline form', () => {
		const segments = parseReasonSegments('This is a {dropdown: repost | duplicate}.',)
		expect(segments[1],).toEqual({
			type: 'token',
			token: {kind: 'choice', placeholder: '', options: ['repost', 'duplicate',], inline: true, dropdown: true,},
		},)
	})

	it('serializes back to the dropdown keyword in both forms', () => {
		expect(serializeToken({kind: 'choice', placeholder: '', options: ['a', 'b',], dropdown: true, id: 'x',},),)
			.toBe('{dropdown#x}\n- a\n- b',)
		expect(serializeToken({kind: 'choice', placeholder: '', options: ['a', 'b',], dropdown: true, inline: true,},),)
			.toBe('{dropdown: a | b}',)
	})

	it('survives canonicalization as a dropdown', () => {
		expect(canonicalizeChoiceBlocks('Pick:\n{dropdown}\n\n- a\n- b\nAfter',),).toBe(
			'Pick:\n\n{dropdown}\n- a\n- b\n\nAfter',
		)
	})

	it('round-trips through the v1 mirror as a marked <select>', () => {
		const html = tokensToHtmlFields('Pick:\n\n{dropdown#rule}\n- a\n- b\n\nAfter',)
		expect(html,).toContain('<select id="rule" data-tbx-dropdown="1">',)
		expect(canonicalizeChoiceBlocks(htmlFieldsToTokens(html,),),).toBe(
			'Pick:\n\n{dropdown#rule}\n- a\n- b\n\nAfter',
		)
	})

	it('reads an unmarked <select> as a {dropdown}, as 6.x showed it', () => {
		expect(
			canonicalizeChoiceBlocks(
				htmlFieldsToTokens('<select id="rule"><option>a</option><option>b</option></select>',),
			),
		)
			.toBe('{dropdown#rule}\n- a\n- b',)
	})

	it('ignoreFieldStyle reads every dropdown as a choice', () => {
		expect(ignoreFieldStyle('{dropdown#r!}\n- a\n\nPick {dropdown: x | y} {dropdowns}',),)
			.toBe('{choice#r!}\n- a\n\nPick {choice: x | y} {dropdowns}',)
	})

	it('ignoreFieldStyle puts options laid out one per line on a single line', () => {
		expect(ignoreFieldStyle('Pick {dropdown#r:\nx |\ny\n} now',),).toBe('Pick {choice#r: x | y} now',)
	})

	it('is never promoted to a tick box', () => {
		expect(promoteLegacyToggles('Keep {dropdown: | extra text} as is',),).toBe(
			'Keep {dropdown: | extra text} as is',
		)
	})

	it('reports a broken marker as a dropdown', () => {
		expect(findLiteralFieldMarker('{dropdown}\nno list here',),)
			.toEqual({kind: 'choice', problem: 'no-options', dropdown: true,},)
	})

	it('substitutes and checks required like a choice', () => {
		const text = '{dropdown!}\n- \n- picked'
		expect(substituteTokenValues(text, ['picked',],),).toBe('picked',)
		expect(findUnfilledRequired(text, ['',],),).toEqual([0,],)
	})
})

describe('inline choices written across lines', () => {
	const written = '**No titles that {dropdown#Option: \nare all-caps | \nare clickbait | \ncontain emoji\n}.**'
	const canonical = '**No titles that {dropdown#Option:\nare all-caps |\nare clickbait |\ncontain emoji\n}.**'

	it('parses one option per line', () => {
		const [, segment,] = parseReasonSegments(written,)
		expect(segment,).toEqual({
			type: 'token',
			token: {
				kind: 'choice',
				id: 'Option',
				placeholder: '',
				options: ['are all-caps', 'are clickbait', 'contain emoji',],
				inline: true,
				dropdown: true,
				multiline: true,
			},
		},)
	})

	it('keeps the layout through canonicalization and normalize, idempotently', () => {
		expect(canonicalizeChoiceBlocks(written,),).toBe(canonical,)
		expect(canonicalizeChoiceBlocks(canonical,),).toBe(canonical,)
	})

	it('sends the picked option in place, with no line breaks', () => {
		expect(substituteTokenValues(canonical, ['are clickbait',],),).toBe('**No titles that are clickbait.**',)
	})

	it('down-converts to a single-line select for 6.x', () => {
		expect(tokensToHtmlFields(canonical,),).toBe(
			'**No titles that <select id="Option" data-tbx-dropdown="1"><option>are all-caps</option>'
				+ '<option>are clickbait</option><option>contain emoji</option></select>.**',
		)
	})

	it('writes a blank option as a bare separator line', () => {
		expect(canonicalizeChoiceBlocks('Do not {choice:\n|\na |\nb\n}',),).toBe('Do not {choice:\n|\na |\nb\n}',)
	})

	it('falls back to a single line when the last option is blank', () => {
		expect(canonicalizeChoiceBlocks('Do not {choice:\na |\n}',),).toBe('Do not {choice: a | }',)
	})

	it('leaves a single-line choice on one line', () => {
		expect(canonicalizeChoiceBlocks('a {choice: x | y} b',),).toBe('a {choice: x | y} b',)
	})
})
