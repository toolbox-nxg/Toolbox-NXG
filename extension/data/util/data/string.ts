/** String manipulation utilities: HTML escaping, templating, regex helpers, and URL path manipulation. */

/** Escapes `&`, `<`, `>`, `"`, `'`, and `/` as HTML entities. */
export function escapeHTML (html: string,): string {
	const entityMap: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		'\'': '&#39;',
		'/': '&#x2F;',
	}

	return String(html,).replace(/[&<>"'/]/g, (s,) => entityMap[s]!,)
}

/**
 * Replaces `{{key}}` placeholders in `tpl` with corresponding values from `variables`.
 * @example template('/r/{{sub}}/comments/{{id}}/', {sub: 'toolbox', id: '2kwx2o'})
 */
export function template (tpl: string, variables: Record<string, unknown>,): string {
	return tpl.replace(/{{([^}]+)}}/g, (_match, variable,) => String(variables[variable],),)
}

/**
 * Builds a regular expression that matches the supplied string literally.
 */
export const literalRegExp = (text: string, flags?: string,): RegExp =>
	new RegExp(text.replace(/([.*+?^=!:${}()|[\]/\\])/g, '\\$1',), flags,)

/**
 * Drops the final path segment from a URL, e.g. `/this/is/url/with/part/`
 * becomes `/this/is/url/with/`.
 */
export function removeLastDirectoryPartOf (url: string,): string {
	const urlNoSlash = url.replace(/\/$/, '',)
	const array = urlNoSlash.split('/',)
	array.pop()
	const returnValue = `${array.join('/',)}/`
	return returnValue
}

/**
 * Replaces {tokens} for the respective value in given content.
 */
export function replaceTokens (info: Record<string, string>, content: string,): string {
	for (const i of Object.keys(info,)) {
		const pattern = new RegExp(`{${i}}`, 'mig',)
		content = content.replace(pattern, info[i]!,)
	}

	return content
}

/**
 * Strips ASCII single and double quote characters out of a string.
 */
export const removeQuotes = (string: string,): string => string.replace(/['"]/g, '',)
