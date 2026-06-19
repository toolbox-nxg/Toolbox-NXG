/** Tests for the removal-reasons overlay helpers, especially the token-to-control rendering pipeline. */

import {describe, expect, it,} from 'vitest'
import type {SelectDefinition,} from '../../../util/wiki/schemas/shared/tokens'
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

	it('converts select references to radio groups with a hidden tracking input', () => {
		const html = renderReasonHtml(parser, 'Pick one: {select:pick}', [
			{name: 'pick', options: ['first', 'second',],},
		],)
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

	it('renders inline select option syntax literally', () => {
		const html = renderReasonHtml(parser, 'Pick one: {select: first | second}',)
		expect(html,).not.toContain('toolbox-radio-group',)
		expect(html,).toContain('{select: first | second}',)
	})

	it('renders block select syntax literally', () => {
		const html = renderReasonHtml(
			parser,
			'{select#rule: Pick one}\n{option} Rule 1 | [details](https://example.com)\n{option} Rule 2\n{/select}',
		)
		expect(html,).not.toContain('toolbox-radio-group',)
		expect(html,).toContain('{select#rule: Pick one}',)
		expect(html,).toContain('{option} Rule 1 |',)
		expect(html,).toContain('{/select}',)
	})

	it('renders a select definition prompt above the choices', () => {
		const html = renderReasonHtml(parser, '{select:rule}', [{
			name: 'rule',
			prompt: 'Pick the *applicable* rule',
			options: ['Rule 1 | [details](https://example.com)', 'Rule 2',],
		},],)
		expect(html,).toContain('toolbox-radio-group-prompt',)
		expect(html,).toContain('<em>applicable</em>',)
		// Pipes inside an option are plain text, and option markdown still renders.
		expect(html,).toContain('value="Rule 1 | [details](https://example.com)"',)
		expect(html,).toContain('<a href="https://example.com">details</a>',)
	})

	it('renders an unresolved select reference literally', () => {
		const html = renderReasonHtml(parser, 'Pick {select:missing} now',)
		expect(html,).not.toContain('toolbox-radio-group',)
		expect(html,).toContain('{select:missing}',)
	})

	it('renders input and textarea tokens inline as form fields', () => {
		const html = renderReasonHtml(parser, 'Reason: {input#why: tell us why} please',)
		expect(html,).toContain('<input id="why" placeholder="tell us why">',)
		// The field stays inside the surrounding markdown paragraph.
		expect(html,).toMatch(/<p>Reason: <input[^>]*> please<\/p>/,)
	})

	it('renders markdown around the select normally', () => {
		const html = renderReasonHtml(
			parser,
			'before *emphasis*\n\n{select:s}\n\nafter',
			[{name: 's', options: ['opt',],},],
		)
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
		selects: SelectDefinition[] = [],
	): RenderedReason {
		return {
			id,
			markdown,
			selects,
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

	it('substitutes input values for tokens in document order', () => {
		const result = composeReasonText(
			[rendered('a', 'Choose {select:x} then {input: why} end', {}, [{name: 'x', options: ['o',],},],),],
			() => undefined,
			() => ['picked', 'because',],
		)
		expect(result.reason,).toBe('Choose picked then because end',)
	})

	it('leaves an unresolved select reference in the composed text', () => {
		const result = composeReasonText(
			[rendered('a', 'Choose {select:missing} then {input: why} end',),],
			() => undefined,
			() => ['because',],
		)
		expect(result.reason,).toBe('Choose {select:missing} then because end',)
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
