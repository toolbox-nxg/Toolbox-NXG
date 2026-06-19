/** Provides a SnuOwnd Markdown parser for generic Reddit-flavored markdown rendering. */

import SnuOwnd from 'snuownd'

/**
 * Returns a SnuOwnd parser for standard Reddit-flavored markdown.
 * Use this for generic markdown rendering (macro previews, comments, etc.).
 */
export function getMarkdownParser () {
	return SnuOwnd.getParser(SnuOwnd.getRedditRenderer(),)
}
