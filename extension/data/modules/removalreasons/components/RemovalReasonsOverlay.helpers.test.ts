/** Tests for the removal-reasons overlay helpers, especially the token-to-control rendering pipeline. */

import {describe, expect, it,} from 'vitest'
import {getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import {
	composeReasonText,
	describeLiteralField,
	getDomainLink,
	type RenderedReason,
	renderReasonHtml,
	requiredFieldsError,
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

	it('converts a {dropdown} block to a <select> carrying the id, first option selected', () => {
		const html = renderReasonHtml(
			parser,
			'Pick one:\n\n{dropdown#pick!}\n- first\n- [second](https://example.com)',
		)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		const select = doc.querySelector<HTMLSelectElement>('select#pick',)!
		expect(select.classList.contains('toolbox-field-required',),).toBe(true,)
		expect(doc.querySelector('input[type="radio"]',),).toBeNull()
		const options = Array.from(select.options,)
		// The option shows a link's text, but its value is the full text that gets sent.
		expect(options.map((option,) => option.textContent),).toEqual(['first', 'second',],)
		expect(options.map((option,) => option.value),).toEqual(['first', '[second](https://example.com)',],)
		expect(select.value,).toBe('first',)
	})

	it('renders an inline {dropdown} inside its paragraph', () => {
		const html = renderReasonHtml(parser, 'This is a {dropdown#kind: repost | duplicate} post.',)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		expect(doc.querySelector('p select#kind',),).not.toBeNull()
	})

	it('converts a {highlight} block to a checkbox group seeded from its [x] ticks', () => {
		const html = renderReasonHtml(parser, '{highlight#rules}\n- [ ] first\n- [x] second',)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		const group = doc.querySelector('.toolbox-check-group',)!
		expect(group.classList.contains('toolbox-check-highlight',),).toBe(true,)
		const boxes = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]',),)
		expect(boxes.map((box,) => box.checked),).toEqual([false, true,],)
		expect(boxes.every((box,) => box.dataset.syncChecks === 'rules'),).toBe(true,)
		const hidden = group.querySelector<HTMLInputElement>('input[type="hidden"]',)!
		expect(hidden.id,).toBe('rules',)
		expect(hidden.value,).toBe('1',)
	})

	it('renders an inline {check} box inside its paragraph', () => {
		const html = renderReasonHtml(parser, 'It was {check: [x] spam} and more.',)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		const group = doc.querySelector('p > span.toolbox-check-group.toolbox-radio-group-inline',)!
		expect(group.querySelector<HTMLInputElement>('input[type="checkbox"]',)!.checked,).toBe(true,)
		expect(group.classList.contains('toolbox-check-highlight',),).toBe(false,)
	})

	it('renders a {note} as a muted span in its paragraph, with no form control', () => {
		const html = renderReasonHtml(parser, 'Rule 5 {note: see [the wiki](https://example.com)} applies.',)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		const note = doc.querySelector('p > span.toolbox-reason-note',)!
		expect(note.querySelector('a',)?.getAttribute('href',),).toBe('https://example.com',)
		expect(doc.querySelector('input, select, textarea',),).toBeNull()
	})

	it('marks required inputs and groups', () => {
		const html = renderReasonHtml(parser, 'Why: {input!: why}\n\n{choice!}\n- a\n- b',)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		expect(doc.querySelector('input[placeholder="why"]',)?.hasAttribute('required',),).toBe(true,)
		expect(doc.querySelector('.toolbox-radio-group',)?.classList.contains('toolbox-field-required',),).toBe(true,)
	})

	it('renders a legacy HTML select as the dropdown 6.x showed', () => {
		const html = renderReasonHtml(
			parser,
			'Pick one: <select id="pick"><option>first</option><option>second</option></select>',
		)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		const select = doc.querySelector<HTMLSelectElement>('select#pick.toolbox-reason-select',)
		expect(select,).not.toBeNull()
		expect(select!.value,).toBe('first',)
		expect(html,).not.toContain('type="radio"',)
	})

	it('renders a legacy select NXG marked as a choice as radio buttons', () => {
		const html = renderReasonHtml(
			parser,
			'Pick one: <select id="pick" data-tbx-choice="1"><option>first</option><option>second</option></select>',
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
		const selects = doc.querySelectorAll<HTMLSelectElement>('select.toolbox-reason-select',)
		expect(selects.length,).toBe(2,)

		const options = Array.from(selects[1]!.options,)
		expect(options.map((option,) => option.value),).toEqual(['', 'B1',],)
		// The blank placeholder stays selected, so picking the reason inserts nothing
		// until a real rule is chosen - matching the 6.x dropdown default.
		expect(selects[1]!.id,).toBe('second',)
		expect(selects[1]!.value,).toBe('',)
	})

	it('renders an inline choice token as a radio group inside its paragraph', () => {
		const html = renderReasonHtml(parser, 'This is a {choice#kind: repost | spam} post.',)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		const paragraph = doc.querySelector('p',)!
		expect(doc.querySelectorAll('p',).length,).toBe(1,)
		expect(paragraph.querySelector('span.toolbox-radio-group-inline',),).not.toBeNull()
		expect(paragraph.textContent,).toMatch(/^This is a .* post\.$/,)
		expect(paragraph.querySelector<HTMLInputElement>('input[type="hidden"]#kind',)?.value,).toBe('repost',)
	})

	it('unwraps a link whose text is an inline choice so picking does not navigate', () => {
		const html = renderReasonHtml(parser, 'This is a [{choice: repost | spam}](https://example.com) post.',)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		expect(doc.querySelector('a[href="https://example.com"]',),).toBeNull()
		const link = doc.querySelector('span.toolbox-choice-link',)
		expect(link?.getAttribute('title',),).toBe('https://example.com',)
		expect(link?.querySelector('.toolbox-radio-group-inline',),).not.toBeNull()
	})

	it('renders an inline legacy select in place rather than on its own line', () => {
		const html = renderReasonHtml(
			parser,
			'This is a <select><option>repost</option><option>spam</option></select> post.',
		)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		expect(doc.querySelectorAll('p',).length,).toBe(1,)
		expect(doc.querySelector('p select.toolbox-reason-select',),).not.toBeNull()
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
		expect(html,).toContain('<span class="toolbox-choice-link" title="https://example.com">details</span>',)
	})

	it('renders an inline dropdown written across lines in place in its sentence', () => {
		const html = renderReasonHtml(parser, '**No titles that {dropdown#o:\nare all-caps |\nare clickbait\n}.**',)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		expect(doc.querySelectorAll('p',).length,).toBe(1,)
		const select = doc.querySelector<HTMLSelectElement>('p strong select#o',)
		expect(Array.from(select?.options ?? [],).map((option,) => option.value),).toEqual([
			'are all-caps',
			'are clickbait',
		],)
	})

	it('unwraps links in option and item labels so a click picks the option', () => {
		const html = renderReasonHtml(
			parser,
			'{choice}\n- [impersonate](https://example.com/a)\n- b\n\n{multi}\n- [ ] [dox](https://example.com/b)',
		)
		const doc = new DOMParser().parseFromString(html, 'text/html',)
		expect(doc.querySelector('.toolbox-radio-label a',),).toBeNull()
		const links = Array.from(doc.querySelectorAll('.toolbox-radio-label .toolbox-choice-link',),)
		expect(links.map((link,) => link.getAttribute('title',)),).toEqual([
			'https://example.com/a',
			'https://example.com/b',
		],)
		// The sent value keeps the link.
		expect(doc.querySelector('input[type="radio"]',)?.getAttribute('value',),)
			.toBe('[impersonate](https://example.com/a)',)
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

	it('turns tick-box values into the markdown they send', () => {
		const result = composeReasonText(
			[rendered(
				'a',
				'Image posts must:\n\n{highlight}\n- [ ] be original\n- [ ] name it\n\nAlso {check: spam}.\n\n',
			),],
			() => undefined,
			() => ['1', '0',],
		)
		expect(result.reason,).toBe('Image posts must:\n\n- be original\n- **name it**\n\nAlso spam.\n\n',)
	})

	it('reports reasons with unfilled required fields, by title', () => {
		const result = composeReasonText(
			[
				rendered('a', 'Why: {input!: why}\n\n', {title: 'Spam',},),
				rendered('b', 'Fine: {input!: ok}\n\n',),
			],
			() => undefined,
			(id,) => id === 'a' ? [' ',] : ['filled',],
		)
		expect(result.unfilled,).toEqual([{id: 'a', title: 'Spam', positions: [0,],},],)
		expect(requiredFieldsError(result.unfilled.map(({title,},) => title),),)
			.toBe('fill in the required fields in: Spam',)
		expect(requiredFieldsError([undefined,],),).toBe('fill in the required fields in the selected reason',)
	})

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

describe('describeLiteralField', () => {
	it('names the field and the list style it takes', () => {
		expect(describeLiteralField({kind: 'choice', problem: 'no-options',},).cause,).toContain('option list',)
		expect(describeLiteralField({kind: 'multi', problem: 'no-options',},).cause,).toContain('"- [ ]" checklist',)
		expect(describeLiteralField({kind: 'highlight', problem: 'inline',},).name,).toBe('tick-box {highlight}',)
	})

	it('points a wrong-style list at the right fix for each side', () => {
		expect(describeLiteralField({kind: 'choice', problem: 'wrong-list',},).fix,).toContain(
			'{multi} or {highlight}',
		)
		expect(describeLiteralField({kind: 'multi', problem: 'wrong-list',},).fix,).toContain('"- [ ] "',)
	})
})
