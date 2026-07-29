// @vitest-environment node
/** Tests for the translation of Reddit's native removal-reason macros. */

import {describe, expect, it,} from 'vitest'

import {findUnresolvedMacros, nativeMacroTokens,} from './nativeMacros'
import type {RemovalReasonsData,} from './schema'

/** Builds overlay context for a removed item. */
function makeData (overrides: Partial<RemovalReasonsData> = {},): RemovalReasonsData {
	return {
		subreddit: 'toolbox_nxg',
		fullname: 't3_post',
		id: 'post',
		author: 'someuser',
		title: 'A post title',
		kind: 'submission',
		mod: 'somemod',
		url: 'https://www.reddit.com/r/toolbox_nxg/comments/abc/a_post_title/',
		link: 'https://example.test/article',
		domain: 'example.test',
		body: '> quoted body',
		raw_body: 'unquoted body',
		uri_body: 'unquoted%20body',
		uri_title: 'A%20post%20title',
		subject: '',
		logReason: '',
		header: '',
		footer: '',
		logSub: '',
		logTitle: '',
		reasons: [],
		...overrides,
	} as RemovalReasonsData
}

describe('nativeMacroTokens', () => {
	it('resolves the content macros from the removed item', () => {
		const tokens = nativeMacroTokens(makeData(),)

		expect(tokens.content_title,).toBe('A post title',)
		expect(tokens.content_link,).toBe('https://www.reddit.com/r/toolbox_nxg/comments/abc/a_post_title/',)
		expect(tokens.content_domain,).toBe('example.test',)
	})

	it('uses Reddit\'s wording for content_type rather than Toolbox\'s', () => {
		// Toolbox's own {kind} says "submission"; Reddit's macro says "post".
		expect(nativeMacroTokens(makeData(),).content_type,).toBe('post',)
		expect(nativeMacroTokens(makeData({kind: 'comment',},),).content_type,).toBe('comment',)
	})

	it('uses the unquoted body, unlike Toolbox\'s {body}', () => {
		const tokens = nativeMacroTokens(makeData(),)

		expect(tokens.content_body,).toBe('unquoted body',)
		expect(tokens.content_body,).not.toContain('>',)
	})

	it('prefixes the community link and builds an absolute rules URL', () => {
		const tokens = nativeMacroTokens(makeData(),)

		expect(tokens.community_link,).toBe('r/toolbox_nxg',)
		// Absolute www, matching Reddit's own output - the author reads this, not the mod.
		expect(tokens.community_rules_url,).toBe('https://www.reddit.com/r/toolbox_nxg/about/rules',)
	})

	it('omits the macros it cannot resolve, so they survive substitution as literal text', () => {
		// Mapping these to '' would silently delete a line the moderator wrote; leaving them
		// out means replaceTokens passes them through and the gap stays visible.
		const tokens = nativeMacroTokens(makeData(),)

		for (const macro of ['community_name', 'community_description', 'community_rule_1', 'linked_community_rule',]) {
			expect(macro in tokens,).toBe(false,)
		}
	})

	it('resolves the community macros once their data has been fetched', () => {
		const tokens = nativeMacroTokens(makeData({
			communityTitle: 'Toolbox-NXG',
			communityDescription: 'For discussion of the Toolbox-NXG extension',
		},),)

		expect(tokens.community_name,).toBe('Toolbox-NXG',)
		expect(tokens.community_description,).toBe('For discussion of the Toolbox-NXG extension',)
	})

	it('numbers the rule macros from one, in the order Reddit returned them', () => {
		const tokens = nativeMacroTokens(makeData({communityRules: ['First rule', 'Second rule',],},),)

		expect(tokens.community_rule_1,).toBe('First rule',)
		expect(tokens.community_rule_2,).toBe('Second rule',)
		// No phantom entry past the end, which would blank a macro the subreddit has no rule for.
		expect('community_rule_3' in tokens,).toBe(false,)
	})

	it('never resolves linked_community_rule, even with the full rules list', () => {
		// The rules list does not say which rule the saved response was bound to, so having it
		// changes nothing here - the macro stays literal.
		const tokens = nativeMacroTokens(makeData({communityRules: ['First rule',],},),)

		expect('linked_community_rule' in tokens,).toBe(false,)
	})
})

describe('findUnresolvedMacros', () => {
	const resolved = {author: 'someuser', content_title: 'A title',}

	it('reports a macro nothing will substitute', () => {
		expect(findUnresolvedMacros('See {linked_community_rule} please', resolved,),)
			.toEqual(['linked_community_rule',],)
	})

	it('ignores macros that will be substituted', () => {
		expect(findUnresolvedMacros('Hi {author}, re {content_title}', resolved,),).toEqual([],)
	})

	it('ignores interactive tokens, which are controls rather than macros', () => {
		// These all carry a ':' or '#', so the bare-name pattern cannot match them.
		const text = '{input: why} {textarea: detail} {choice#pick} {select:kind} {input#id: label}'

		expect(findUnresolvedMacros(text, resolved,),).toEqual([],)
	})

	it('reports each unresolved macro once, in first-seen order', () => {
		const text = '{one} then {two} then {one} again'

		expect(findUnresolvedMacros(text, resolved,),).toEqual(['one', 'two',],)
	})

	it('finds nothing in text with no macros at all', () => {
		expect(findUnresolvedMacros('Just ordinary prose.', resolved,),).toEqual([],)
	})
})
