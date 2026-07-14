/** Tests for the removal-reasons overlay helpers, especially the token-to-control rendering pipeline. */

import {describe, expect, it,} from 'vitest'
import {getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import {
	composeReasonText,
	getDomainLink,
	RenderedReason,
	renderReasonHtml,
	settingToReasonType,
} from './RemovalReasonsOverlay.helpers'

describe('settingToReasonType', () => {
	it('maps each stored setting value', () => {
		expect(settingToReasonType('reply_with_a_comment_to_the_item_that_is_removed',),).toBe('reply',)
		expect(settingToReasonType('send_as_pm_(personal_message)',),).toBe('pm',)
		expect(settingToReasonType('send_as_both_pm_and_reply',),).toBe('both',)
		expect(settingToReasonType('none_(this_only_works_when_a_logsub_has_been_set)',),).toBe('none',)
	})

	it('defaults unknown values to reply', () => {
		expect(settingToReasonType('what',),).toBe('reply',)
	})
})

describe('getDomainLink', () => {
	it('links external domains', () => {
		expect(getDomainLink('imgur.com',),).toBe('https://old.reddit.com/domain/imgur.com',)
	})

	it('returns null for self posts and missing domains', () => {
		expect(getDomainLink('self.mysub',),).toBeNull()
		expect(getDomainLink(undefined,),).toBeNull()
	})
})

describe('renderReasonHtml', () => {
	const parser = getRemovalReasonParser()

	it('renders plain markdown', () => {
		const html = renderReasonHtml(parser, 'Some **bold** text',)
		expect(html,).toContain('<strong>bold</strong>',)
	})

	it('converts a {choice} block to a radio group with a hidden tracking input', () => {
		const html = renderReasonHtml(parser, 'Pick one:\n\n{choice#pick}\n- first\n- second',)
		expect(html,).toContain('toolbox-radio-group',)
		expect(html,).toContain('type="radio"',)
		expect(html,).toContain('type="hidden"',)
		expect(html,).toContain('id="pick"',)
		// First option is pre-selected and seeds the hidden input value.
		expect(html,).toContain('value="first"',)
	})

	it('converts legacy HTML select elements the same way', () => {
		const html = renderReasonHtml(
			parser,
			'Pick one: <select id="pick"><option>first</option><option>second</option></select>',
		)
		expect(html,).toContain('toolbox-radio-group',)
		expect(html,).toContain('type="radio"',)
		expect(html,).toContain('type="hidden"',)
		expect(html,).toContain('id="pick"',)
		expect(html,).toContain('value="first"',)
	})

	it('renders every select when one opens with a blank option (issue #22)', () => {
		const html = renderReasonHtml(
			parser,
			'<select id="first"><option>A1</option><option>A2</option></select>'
				+ '<select id="second"><option></option><option>B1</option></select>',
		)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		const groups = doc.querySelectorAll('.toolbox-radio-group',)
		expect(groups.length,).toBe(2,)

		const radios = Array.from(groups[1]!.querySelectorAll<HTMLInputElement>('input[type="radio"]',),)
		expect(radios.map((radio,) => radio.value),).toEqual(['', 'B1',],)
		// The blank placeholder stays selected, so picking the reason inserts nothing
		// until a real rule is chosen - matching the 6.x dropdown default.
		expect(radios[0]!.hasAttribute('checked',),).toBe(true,)
		expect(doc.querySelector<HTMLInputElement>('input[type="hidden"]#second',)?.value,).toBe('',)
	})

	it('renders an inline (not own-line) choice marker literally', () => {
		const html = renderReasonHtml(parser, 'Pick one: {choice#x} now',)
		expect(html,).not.toContain('toolbox-radio-group',)
		expect(html,).toContain('{choice#x}',)
	})

	it('renders a choice marker with no list below it literally', () => {
		const html = renderReasonHtml(parser, '{choice#rule}\n\nnot a list',)
		expect(html,).not.toContain('toolbox-radio-group',)
		expect(html,).toContain('{choice#rule}',)
	})

	it('renders text above the block as markdown and option markdown inside it', () => {
		const html = renderReasonHtml(
			parser,
			'Pick the *applicable* rule\n\n{choice}\n- Rule 1 | [details](https://example.com)\n- Rule 2',
		)
		expect(html,).toContain('<em>applicable</em>',)
		// Pipes inside an option are plain text, and option markdown still renders.
		expect(html,).toContain('value="Rule 1 | [details](https://example.com)"',)
		expect(html,).toContain('<a href="https://example.com">details</a>',)
	})

	it('renders input and textarea tokens inline as form fields', () => {
		const html = renderReasonHtml(parser, 'Reason: {input#why: tell us why} please',)
		expect(html,).toContain('<input id="why" placeholder="tell us why">',)
		// The field stays inside the surrounding markdown paragraph.
		expect(html,).toMatch(/<p>Reason: <input[^>]*> please<\/p>/,)
	})

	it('renders markdown around the block normally', () => {
		const html = renderReasonHtml(parser, 'before *emphasis*\n\n{choice}\n- opt\n\nafter',)
		expect(html,).toContain('<em>emphasis</em>',)
		expect(html,).toContain('after',)
		expect(html,).toContain('toolbox-radio-group',)
	})
})

describe('composeReasonText', () => {
	function rendered (
		id: string,
		markdown: string,
		reasonExtra: Record<string, string> = {},
	): RenderedReason {
		return {
			id,
			markdown,
			html: '',
			reason: {text: markdown, title: '', flairText: '', flairCSS: '', flairTemplateID: '', ...reasonExtra,},
		}
	}

	it('uses the override text when present', () => {
		const result = composeReasonText(
			[rendered('a', 'original',),],
			() => 'edited text',
			() => [],
		)
		expect(result.reason,).toBe('edited text\n\n',)
	})

	it('substitutes input values into an override, not the literal field markup', () => {
		const result = composeReasonText(
			[rendered('a', 'original',),],
			() => 'Choose:\n\n{choice}\n- o\n\nthen {input: why} end',
			() => ['picked', 'because',],
		)
		expect(result.reason,).toBe('Choose:\n\npicked\n\nthen because end\n\n',)
		expect(result.reason,).not.toContain('{choice}',)
		expect(result.reason,).not.toContain('{input:',)
	})

	it('substitutes input values into an override that still uses legacy HTML fields', () => {
		const result = composeReasonText(
			[rendered('a', 'original',),],
			() => 'Reason: <input id="why"> end',
			() => ['because',],
		)
		expect(result.reason,).toBe('Reason: because end\n\n',)
		expect(result.reason,).not.toContain('<input',)
	})

	it('substitutes input and choice values for tokens in document order', () => {
		const result = composeReasonText(
			[rendered('a', 'Choose:\n\n{choice}\n- o\n\nthen {input: why} end',),],
			() => undefined,
			() => ['picked', 'because',],
		)
		expect(result.reason,).toBe('Choose:\n\npicked\n\nthen because end',)
	})

	it('accumulates flair from all selected reasons', () => {
		const result = composeReasonText(
			[
				rendered('a', 'one', {flairText: 'Spam', flairCSS: 'spam',},),
				rendered('b', 'two', {flairText: 'Rule 2', flairTemplateID: 'tpl-2',},),
			],
			() => undefined,
			() => [],
		)
		expect(result.flairText,).toBe(' Spam Rule 2',)
		expect(result.flairCSS,).toBe(' spam',)
		expect(result.flairTemplateID,).toBe('tpl-2',)
	})

	it('returns per-reason pieces keyed by the persistent id, with resolved text', () => {
		const result = composeReasonText(
			[
				rendered('reason-0', 'Choose {input: why} end', {id: 'persist-a', title: 'Rule 1',},),
				rendered('reason-1', 'second', {id: 'persist-b',},),
			],
			(id,) => (id === 'reason-1' ? 'edited second' : undefined),
			() => ['because',],
		)
		expect(result.pieces,).toEqual([
			{id: 'persist-a', text: 'Choose because end', title: 'Rule 1',},
			{id: 'persist-b', text: 'edited second',},
		],)
	})

	it('falls back to the positional id in a piece when a reason has no persistent id', () => {
		const result = composeReasonText([rendered('reason-0', 'body',),], () => undefined, () => [],)
		expect(result.pieces[0]!.id,).toBe('reason-0',)
	})
})
