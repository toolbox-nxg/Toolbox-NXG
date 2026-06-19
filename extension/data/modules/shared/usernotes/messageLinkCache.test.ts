/** Tests for the page-session removal message link cache. */

import {beforeEach, describe, expect, it,} from 'vitest'

import {clearMessageLinks, getMessageLink, normalizePermalinkKey, rememberMessageLink,} from './messageLinkCache'

const conversation = 'https://www.reddit.com/mail/perma/abc123'

beforeEach(() => {
	clearMessageLinks()
},)

describe('normalizePermalinkKey', () => {
	it('strips the origin from absolute URLs', () => {
		expect(normalizePermalinkKey('https://www.reddit.com/r/sub/comments/abc/title/def/',),)
			.toBe('/r/sub/comments/abc/title/def',)
	})

	it('normalizes trailing slashes and case', () => {
		expect(normalizePermalinkKey('/r/Sub/comments/abc/Title/def',),)
			.toBe(normalizePermalinkKey('/r/sub/comments/abc/title/def/',),)
	})

	it('drops query strings and fragments', () => {
		expect(normalizePermalinkKey('/r/sub/comments/abc/?context=3#thing',),)
			.toBe('/r/sub/comments/abc',)
	})

	it('returns the empty string for empty or unparseable input', () => {
		expect(normalizePermalinkKey('',),).toBe('',)
		expect(normalizePermalinkKey('https://',),).toBe('',)
	})
})

describe('rememberMessageLink / getMessageLink', () => {
	it('finds a remembered link by any permalink form of the thing', () => {
		rememberMessageLink(['https://www.reddit.com/r/sub/comments/abc/title/def/',], conversation,)

		expect(getMessageLink('/r/sub/comments/abc/title/def',),).toBe(conversation,)
		expect(getMessageLink('https://old.reddit.com/r/sub/comments/abc/title/def/',),).toBe(conversation,)
	})

	it('registers all provided permalinks, skipping falsy and unusable ones', () => {
		rememberMessageLink(
			['/r/sub/comments/abc/title/def/', '/r/sub/comments/abc/', undefined, '',],
			conversation,
		)

		expect(getMessageLink('/r/sub/comments/abc/title/def',),).toBe(conversation,)
		expect(getMessageLink('/r/sub/comments/abc',),).toBe(conversation,)
	})

	it('returns undefined for unknown things and empty lookups', () => {
		rememberMessageLink(['/r/sub/comments/abc/',], conversation,)

		expect(getMessageLink('/r/sub/comments/zzz/',),).toBeUndefined()
		expect(getMessageLink('',),).toBeUndefined()
	})

	it('ignores registrations with no message link', () => {
		rememberMessageLink(['/r/sub/comments/abc/',], '',)

		expect(getMessageLink('/r/sub/comments/abc/',),).toBeUndefined()
	})
})
