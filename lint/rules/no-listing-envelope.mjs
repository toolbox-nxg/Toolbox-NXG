/**
 * `toolbox/no-listing-envelope` — keeps the Reddit REST pagination envelope inside the API layer.
 *
 * Reddit's `.json` listing endpoints wrap results in `{kind: 'Listing', data:
 * {children, after, before}}`. That envelope is a transport detail: `after` is a REST
 * cursor with no equivalent in a cursor-connection API. Feature code consumes the
 * transport-neutral `Page<T>` from `api/transport/pagination` instead, so paging lives
 * in one place rather than being re-derived at every call site.
 *
 * Two checks, both scoped to TypeScript under `extension/data/` but outside `extension/data/api/`:
 *   1. No importing `RedditListing` — resource modules return `Page<T>`.
 *   2. No `.data.after` / `.data.before` access — those are pagination-only.
 *
 * `.data.children` is deliberately NOT flagged. Reddit's comment tree nests Listings
 * recursively (`RedditThing.replies`, and `more.data.children` which is an array of
 * comment ids), so `children` access is legitimate tree traversal in comment code. The
 * two checks above have no such overlap and therefore no false positives.
 */

import {isTypeScriptSource, repoPath, specifierName,} from './paths.mjs'

/** The envelope type that must not escape the API layer. */
const RESTRICTED_TYPE = 'RedditListing'

/** Envelope cursor fields that are pagination-only, and so never legitimate outside the API layer. */
const RESTRICTED_FIELDS = new Set(['after', 'before',],)

/**
 * Whether the rule applies to a repo-relative path. Files under `extension/data/api/` own the
 * envelope: naming `RedditListing` and unwrapping `data.after` is precisely their job.
 * @param {string} path Repo-relative POSIX path.
 * @returns {boolean} `true` for TypeScript under `extension/data/` outside the API layer.
 */
export function isGuardedFile (path,) {
	return path.startsWith('extension/data/',) && !path.startsWith('extension/data/api/',) && isTypeScriptSource(path,)
}

/** Whether `node` is a non-computed `.name` property access. */
function isPropertyAccess (node, name,) {
	return node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier'
		&& (name === undefined || node.property.name === name)
}

/** @type {import('oxlint/plugins-dev').Rule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Keep the REST listing envelope (`RedditListing`, `.data.after`/`.data.before`) inside the API layer.',
		},
		messages: {
			listingImport: 'Imports `RedditListing` — resource modules return `Page<T>`; '
				+ 'import that from api/transport/pagination instead.',
			cursorAccess: 'Reads `.data.{{field}}` — that is the REST listing cursor; '
				+ 'use `Page.cursor` from api/transport/pagination instead.',
		},
		schema: [],
	},
	create (context,) {
		if (!isGuardedFile(repoPath(context,),)) { return {} }

		return {
			ImportDeclaration (node,) {
				for (const specifier of node.specifiers) {
					if (
						specifier.type === 'ImportSpecifier' && specifierName(specifier.imported,) === RESTRICTED_TYPE
					) {
						context.report({node: specifier, messageId: 'listingImport',},)
					}
				}
			},
			MemberExpression (node,) {
				if (
					isPropertyAccess(node,) && RESTRICTED_FIELDS.has(node.property.name,)
					&& isPropertyAccess(node.object, 'data',)
				) {
					context.report({node, messageId: 'cursorAccess', data: {field: node.property.name,},},)
				}
			},
		}
	},
}
