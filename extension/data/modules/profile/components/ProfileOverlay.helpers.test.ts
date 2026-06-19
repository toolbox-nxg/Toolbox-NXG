/** Tests for ProfileOverlay helpers. */

import {describe, expect, it,} from 'vitest'

import {
	applyProfileEntryFilters,
	applyRepostHighlights,
	compileProfileSearch,
	computeRepostGroups,
	getProfileThings,
	normalizeProfileSubreddit,
	normalizeRepostText,
	normalizeRepostUrl,
	profileListingEntryMatches,
} from './ProfileOverlay.helpers'

function thing (subreddit: string, moderator = false,) {
	const element = document.createElement('article',)
	element.className = 'toolbox-submission toolbox-thing'
	element.setAttribute('data-subreddit', subreddit,)
	if (moderator) {
		const attr = document.createElement('span',)
		attr.className = 'toolbox-moderator'
		element.appendChild(attr,)
	}
	return element
}

describe('ProfileOverlay helpers', () => {
	it('finds rendered toolbox things instead of only old div.thing entries', () => {
		const container = document.createElement('div',)
		container.append(thing('Toolbox',),)

		expect(getProfileThings(container,),).toHaveLength(1,)
	})

	it('normalizes subreddit names case-insensitively', () => {
		expect(normalizeProfileSubreddit('/r/ToolBox/',),).toBe('toolbox',)
		expect(normalizeProfileSubreddit('r/Example',),).toBe('example',)
	})

	it('hides mod actions and unmoddable entries independently', () => {
		const container = document.createElement('div',)
		const moderated = thing('ToolBox',)
		const other = thing('OtherSub',)
		const modAction = thing('ToolBox', true,)
		container.append(moderated, other, modAction,)

		expect(applyProfileEntryFilters(container, {
			filterModThings: true,
			hideModActions: true,
			moderatedSubreddits: ['toolbox',],
		},),).toBe(1,)

		expect(moderated.classList.contains('toolbox-mod-filtered',),).toBe(false,)
		expect(other.classList.contains('toolbox-mod-filtered',),).toBe(true,)
		expect(modAction.classList.contains('toolbox-mod-hidden',),).toBe(true,)
	})

	it('reports zero visible entries when filters remove every thing', () => {
		const container = document.createElement('div',)
		container.append(thing('OtherSub',),)

		expect(applyProfileEntryFilters(container, {
			filterModThings: true,
			hideModActions: false,
			moderatedSubreddits: ['toolbox',],
		},),).toBe(0,)
	})

	it('matches literal subreddit and content searches', () => {
		const search = compileProfileSearch({subreddit: 'toolbox', content: 'a.b', regex: false,},)

		expect(profileListingEntryMatches({
			kind: 't1',
			data: {subreddit: 'Toolbox', body: 'literal a.b text',},
		}, search,),).toBe(true,)
		expect(profileListingEntryMatches({
			kind: 't1',
			data: {subreddit: 'Toolbox', body: 'literal axb text',},
		}, search,),).toBe(false,)
	})

	it('supports opt-in regex content search without global regex state', () => {
		const search = compileProfileSearch({subreddit: '', content: 'foo$', regex: true,},)
		const entry = {kind: 't3', data: {subreddit: 'Toolbox', title: 'one foo', selftext: '',},}

		expect(profileListingEntryMatches(entry, search,),).toBe(true,)
		expect(profileListingEntryMatches(entry, search,),).toBe(true,)
	})

	it('returns a validation error for invalid regex search', () => {
		const search = compileProfileSearch({subreddit: '', content: '[', regex: true,},)

		expect(search.error,).toContain('Invalid regex',)
	})
})

/** Builds a minimal `t3` submission API child for repost tests. */
function submission (name: string, subreddit: string, fields: Record<string, unknown> = {},) {
	return {kind: 't3', data: {name, subreddit, is_self: false, ...fields,},}
}

/** Builds a minimal `t1` comment API child for repost tests. */
function comment (name: string, subreddit: string, body: string,) {
	return {kind: 't1', data: {name, subreddit, body,},}
}

describe('repost detection helpers', () => {
	it('normalizes URLs by host, www, tracking params, and trailing slash', () => {
		expect(normalizeRepostUrl('https://www.Example.com/Path/?utm_source=x&ref=y',),)
			.toBe('example.com/Path',)
		expect(normalizeRepostUrl('http://example.com/path/',),).toBe('example.com/path',)
		// Differ only in www/protocol/tracking → identical signatures.
		expect(normalizeRepostUrl('https://example.com/a?utm_medium=z',),)
			.toBe(normalizeRepostUrl('http://www.example.com/a',),)
	})

	it('returns null for unparseable or non-http URLs', () => {
		expect(normalizeRepostUrl('not a url',),).toBeNull()
		expect(normalizeRepostUrl('ftp://example.com/file',),).toBeNull()
		expect(normalizeRepostUrl('',),).toBeNull()
	})

	it('strips non-alphanumerics so formatting-only differences collapse', () => {
		expect(normalizeRepostText('Hello, WORLD! This is text.',),)
			.toBe(normalizeRepostText('hello world this is text',),)
	})

	it('rejects text shorter than the minimum signature length', () => {
		expect(normalizeRepostText('thanks!',),).toBeNull()
		expect(normalizeRepostText('this is long enough now',),).not.toBeNull()
	})

	it('flags a duplicate link across two subreddits as a cross-sub repost', () => {
		const {byFullname,} = computeRepostGroups([
			submission('t3_1', 'subA', {url: 'https://example.com/article', title: 'first headline here',},),
			submission('t3_2', 'subB', {url: 'https://www.example.com/article', title: 'totally different title',},),
		],)

		expect(byFullname.get('t3_1',)?.crossSub,).toBe(true,)
		expect(byFullname.get('t3_2',)?.crossSub,).toBe(true,)
		expect(byFullname.get('t3_1',)?.matchType,).toBe('link',)
		expect(byFullname.get('t3_1',)?.count,).toBe(2,)
	})

	it('flags duplicate titles in the same subreddit as a same-sub repost', () => {
		const {byFullname,} = computeRepostGroups([
			submission('t3_1', 'subA', {url: 'https://a.example/1', title: 'Same Headline, Repeated!',},),
			submission('t3_2', 'subA', {url: 'https://b.example/2', title: 'same headline repeated',},),
		],)

		expect(byFullname.get('t3_1',)?.crossSub,).toBe(false,)
		expect(byFullname.get('t3_1',)?.matchType,).toBe('text',)
	})

	it('flags self-posts that share selftext but have different titles', () => {
		const {byFullname,} = computeRepostGroups([
			submission('t3_1', 'subA', {
				is_self: true,
				title: 'first unique title',
				selftext: 'This is the shared body content that repeats.',
			},),
			submission('t3_2', 'subA', {
				is_self: true,
				title: 'second unique title',
				selftext: 'this is the shared body content that repeats',
			},),
		],)

		expect(byFullname.has('t3_1',),).toBe(true,)
		expect(byFullname.has('t3_2',),).toBe(true,)
	})

	it('flags duplicate comment bodies and ignores unique entries', () => {
		const {byFullname, groups,} = computeRepostGroups([
			comment('t1_1', 'subA', 'Buy my product at spam dot com now!',),
			comment('t1_2', 'subB', 'buy my product at spam dot com now',),
			comment('t1_3', 'subA', 'a totally unrelated comment body here',),
		],)

		expect(byFullname.has('t1_1',),).toBe(true,)
		expect(byFullname.has('t1_2',),).toBe(true,)
		expect(byFullname.has('t1_3',),).toBe(false,)
		const group = byFullname.get('t1_1',)!.groupKey
		expect(groups.get(group,),).toEqual(new Set(['t1_1', 't1_2',],),)
	})

	it('applies repost classes and a clickable badge, and clears them when disabled', () => {
		const container = document.createElement('div',)
		const repost = thing('subA',)
		repost.setAttribute('data-fullname', 't3_1',)
		const title = document.createElement('span',)
		title.className = 'toolbox-title'
		repost.append(title,)
		const normal = thing('subA',)
		normal.setAttribute('data-fullname', 't3_9',)
		container.append(repost, normal,)

		const byFullname = new Map([
			['t3_1', {count: 2, crossSub: false, matchType: 'text' as const, groupKey: 'text:abc',},],
		],)
		const groups = new Map([['text:abc', new Set(['t3_1', 't3_2',],),],],)

		applyRepostHighlights(container, byFullname, groups, true, null, false,)
		expect(repost.classList.contains('toolbox-repost',),).toBe(true,)
		const badge = repost.querySelector('.toolbox-repost-badge',)
		expect(badge?.getAttribute('data-repost-group',),).toBe('text:abc',)
		expect(normal.classList.contains('toolbox-repost',),).toBe(false,)

		applyRepostHighlights(container, byFullname, groups, false, null, false,)
		expect(repost.classList.contains('toolbox-repost',),).toBe(false,)
		expect(repost.querySelector('.toolbox-repost-badge',),).toBeNull()
	})

	it('isolates a group by hiding non-members when an active group is set', () => {
		const container = document.createElement('div',)
		const member = thing('subA',)
		member.setAttribute('data-fullname', 't3_1',)
		const nonMember = thing('subA',)
		nonMember.setAttribute('data-fullname', 't3_9',)
		container.append(member, nonMember,)

		const byFullname = new Map([
			['t3_1', {count: 2, crossSub: false, matchType: 'text' as const, groupKey: 'text:abc',},],
		],)
		const groups = new Map([['text:abc', new Set(['t3_1', 't3_2',],),],],)

		applyRepostHighlights(container, byFullname, groups, true, 'text:abc', false,)
		expect(member.classList.contains('toolbox-repost-filtered',),).toBe(false,)
		expect(nonMember.classList.contains('toolbox-repost-filtered',),).toBe(true,)
	})

	it('hides non-reposts when showOnlyReposts is set', () => {
		const container = document.createElement('div',)
		const repost = thing('subA',)
		repost.setAttribute('data-fullname', 't3_1',)
		const normal = thing('subA',)
		normal.setAttribute('data-fullname', 't3_9',)
		container.append(repost, normal,)

		const byFullname = new Map([
			['t3_1', {count: 2, crossSub: false, matchType: 'text' as const, groupKey: 'text:abc',},],
		],)
		const groups = new Map([['text:abc', new Set(['t3_1', 't3_2',],),],],)

		applyRepostHighlights(container, byFullname, groups, true, null, true,)
		expect(repost.classList.contains('toolbox-repost-filtered',),).toBe(false,)
		expect(normal.classList.contains('toolbox-repost-filtered',),).toBe(true,)
	})
})
