/** Tests for the pure domain-matching helpers. */

import {describe, expect, it,} from 'vitest'

import {findTagForDomain, matchesGlob,} from './matching'
import type {DomainTag,} from './schema'

/** Builds a DomainTag with the given name (counts/color are irrelevant to matching). */
function tag (name: string,): DomainTag {
	return {name, color: '#fff', approvalCount: 0, removalCount: 0,}
}

describe('matchesGlob', () => {
	it('expands * to .* and anchors the whole string', () => {
		expect(matchesGlob('i.imgur.com', '*.imgur.com',),).toBe(true,)
		expect(matchesGlob('imgur.com', '*.imgur.com',),).toBe(false,)
	})

	it('escapes regex metacharacters in the literal parts', () => {
		expect(matchesGlob('a.b.com', 'a.b.com',),).toBe(true,) // codeql[js/incomplete-hostname-regexp] -- test fixture; matchesGlob escapes the dot (matching.ts:17)
		expect(matchesGlob('axbxcom', 'a.b.com',),).toBe(false,) // codeql[js/incomplete-hostname-regexp] -- this very assertion proves the dot is escaped, not a wildcard
	})
})

describe('findTagForDomain', () => {
	it('prefers an exact match over glob and suffix', () => {
		const tags = [tag('*.imgur.com',), tag('imgur.com',), tag('i.imgur.com',),] // codeql[js/incomplete-hostname-regexp] -- test fixture; matchesGlob escapes the dot (matching.ts:17)
		expect(findTagForDomain('i.imgur.com', tags,)?.name,).toBe('i.imgur.com',)
	})

	it('falls back to glob, then to suffix', () => {
		expect(findTagForDomain('i.imgur.com', [tag('*.imgur.com',), tag('imgur.com',),],)?.name,).toBe('*.imgur.com',)
		expect(findTagForDomain('i.imgur.com', [tag('imgur.com',),],)?.name,).toBe('imgur.com',)
	})

	it('returns null when nothing matches', () => {
		expect(findTagForDomain('example.com', [tag('imgur.com',),],),).toBeNull()
	})

	it('matches a legacy www-prefixed tag against the now-www-less lookup domain', () => {
		// A tag created on Shreddit before domains were normalized may be stored as `www.example.com`;
		// the www-less lookup must still find it (and increment its stat counters).
		expect(findTagForDomain('example.com', [tag('www.example.com',),],)?.name,).toBe('www.example.com',) // codeql[js/incomplete-hostname-regexp] -- test fixture; matchesGlob escapes the dot (matching.ts:17)
	})

	it('does not broaden a www-prefixed tag to subdomains of the bare domain', () => {
		// `www.imgur.com` should match only `imgur.com` (its www-less self), not `i.imgur.com`.
		expect(findTagForDomain('i.imgur.com', [tag('www.imgur.com',),],),).toBeNull() // codeql[js/incomplete-hostname-regexp] -- test fixture; matchesGlob escapes the dot (matching.ts:17)
		expect(findTagForDomain('imgur.com', [tag('www.imgur.com',),],)?.name,).toBe('www.imgur.com',) // codeql[js/incomplete-hostname-regexp] -- test fixture; matchesGlob escapes the dot (matching.ts:17)
	})
})
