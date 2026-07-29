/** Translation of Reddit's native removal-reason macros onto values Toolbox already resolves. */

import type {RemovalReasonsData,} from './schema'

/**
 * Reddit's saved-response macros, resolved against the item being removed.
 *
 * Reddit spells its macros with the same single braces Toolbox uses, but every one carries a
 * `community_`, `content_` or `linked_` prefix, so the two namespaces cannot collide and one
 * substitution pass serves both. That is why these can be folded straight into the overlay's
 * token source rather than needing a separate pass over native-origin text.
 *
 * Macros Reddit resolves but Toolbox cannot are deliberately left out rather than mapped to an
 * empty string. `replaceTokens` leaves an unrecognized token untouched, so the moderator sees
 * the macro text and can tell it did not resolve, instead of the message quietly losing a line.
 *
 * The community macros resolve only when their data was fetched (see `communityTitle` and
 * friends on {@link RemovalReasonsData}); the fetch is skipped on removals whose reasons never
 * mention them.
 *
 * `{linked_community_rule}` is the one macro that cannot be resolved at all. It names the rule
 * bound to a saved response, and that binding is not in the removal-reasons API - a reason comes
 * back as `id`/`title`/`message` and nothing else. Having the rules list does not help, because
 * the problem is knowing *which* rule was linked, not how to render it.
 * @param data The overlay's context for the item being removed.
 */
export function nativeMacroTokens (data: RemovalReasonsData,): Record<string, string> {
	const community: Record<string, string> = {}
	// Each is added only when it was actually fetched. A missing value must not become '',
	// or the macro would silently vanish from the message instead of showing it did not resolve.
	if (data.communityTitle !== undefined) { community.community_name = data.communityTitle }
	if (data.communityDescription !== undefined) {
		community.community_description = data.communityDescription
	}
	// Reddit numbers these from 1, in the moderators' configured rule order.
	data.communityRules?.forEach((rule, index,) => {
		community[`community_rule_${index + 1}`] = rule
	},)

	return {
		...community,
		// Reddit says "post" where Toolbox's own {kind} says "submission". This is Reddit's
		// macro, so it keeps Reddit's wording.
		content_type: data.kind === 'comment' ? 'comment' : 'post',
		content_title: data.title,
		// Unquoted on purpose: Toolbox's {body} prefixes each line with "> ", Reddit's does not.
		content_body: data.raw_body,
		content_link: data.url,
		content_domain: data.domain,
		community_link: `r/${data.subreddit}`,
		// Absolute www URL, matching what Reddit's own substitution emits. The removal message is
		// read by the author, so it must not depend on which Reddit the moderator happens to use.
		community_rules_url: `https://www.reddit.com/r/${data.subreddit}/about/rules`,
	}
}

/**
 * Finds `{macro}` references in reason text that nothing will substitute, so the overlay can
 * warn before the moderator sends them.
 *
 * Substitution leaves an unrecognized token untouched, which means it reaches the removed user
 * verbatim. That is deliberate - blanking it would silently delete a line and make the preview
 * disagree with what was sent - but the moderator is the one who can act on it, so it has to be
 * surfaced to them rather than left for the author to discover.
 *
 * Only bare `{name}` forms are considered. Toolbox's interactive tokens all carry a `:` or `#`
 * (`{input: label}`, `{choice#id}`), so they cannot be mistaken for an unresolved macro.
 * @param text The reason text to scan.
 * @param resolved The token names substitution will replace.
 */
export function findUnresolvedMacros (text: string, resolved: Record<string, string>,): string[] {
	const found = new Set<string>()
	for (const [, name,] of text.matchAll(/\{([a-z0-9_]+)\}/gi,)) {
		if (name !== undefined && !(name in resolved)) { found.add(name,) }
	}
	return [...found,]
}
