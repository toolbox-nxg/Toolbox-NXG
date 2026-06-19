/**
 * Pure domain-matching helpers shared by the domaintagger DOM layer and its module API.
 * Kept in their own module so both `dom.tsx` and `moduleapi.ts` can import them without
 * creating a circular dependency (`dom.tsx` already imports from `moduleapi.ts`).
 */

import {type DomainTag,} from './schema'

/**
 * Tests whether `domain` matches a glob `pattern`. The pattern's regex metacharacters are
 * escaped and each `*` is expanded to `.*`, then anchored to match the whole string.
 * @param domain The full domain string to test (e.g. `"i.imgur.com"`).
 * @param pattern A glob pattern containing at least one `*`.
 */
export function matchesGlob (domain: string, pattern: string,): boolean {
	const regex = new RegExp(
		'^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&',).replace(/\*/g, '.*',) + '$',
	)
	return regex.test(domain,)
}

/**
 * Returns the first {@link DomainTag} matching `domain`, using this priority order:
 * 1. Exact match (`domain === tag.name`)
 * 2. Glob match (tag name contains `*`, tested with {@link matchesGlob})
 * 3. Suffix match (domain ends with the tag name)
 * Returns `null` if no tag matches.
 * @param domain The full domain string to test (e.g. `"i.imgur.com"`).
 * @param domainTags The configured tag list to search.
 */
export function findTagForDomain (domain: string, domainTags: DomainTag[],): DomainTag | null {
	let globMatch: DomainTag | null = null
	let suffixMatch: DomainTag | null = null
	for (const tag of domainTags) {
		if (domain === tag.name) { return tag }
		// Tags created on Shreddit before domains were www-normalized may carry a leading `www.`, which
		// the now-www-less lookup domain would otherwise never match (its name is longer, so the suffix
		// test fails too). Accept the www-less equivalent - exact-only, so a `www.x` tag isn't broadened
		// to subdomains of `x`. Stat counters live on the tag, so this keeps their tallies on one tag too.
		if (tag.name.startsWith('www.',) && domain === tag.name.slice(4,)) { return tag }
		if (tag.name.includes('*',)) {
			if (!globMatch && matchesGlob(domain, tag.name,)) { globMatch = tag }
		} else if (!suffixMatch && domain.endsWith(tag.name,)) {
			suffixMatch = tag
		}
	}
	return globMatch ?? suffixMatch
}
