/** Tests for string utilities. */

import {describe, expect, it,} from 'vitest'

import {escapeHTML, literalRegExp, removeLastDirectoryPartOf, removeQuotes, replaceTokens, template,} from './string'

describe('string utilities', () => {
	it('escapes HTML-sensitive characters', () => {
		expect(escapeHTML(`<a href="/x?y=1&z='2'">go</a>`,),).toBe(
			'&lt;a href=&quot;&#x2F;x?y=1&amp;z=&#39;2&#39;&quot;&gt;go&lt;&#x2F;a&gt;',
		)
	})

	it('replaces template variables', () => {
		expect(template('/r/{{subreddit}}/comments/{{id}}/{{title}}/', {
			subreddit: 'toolbox',
			id: 'abc123',
			title: 'test_post',
		},),).toBe('/r/toolbox/comments/abc123/test_post/',)
	})

	it('builds literal regular expressions for metacharacters', () => {
		expect('a+b?'.match(literalRegExp('a+b?',),)?.[0],).toBe('a+b?',)
		expect(literalRegExp('a+b?',).test('aaab',),).toBe(false,)
	})

	it('removes the last directory from a URL-like path', () => {
		expect(removeLastDirectoryPartOf('/this/is/url/with/part/',),).toBe('/this/is/url/with/',)
		expect(removeLastDirectoryPartOf('/this/is/url/with/part',),).toBe('/this/is/url/with/',)
	})

	it('replaces tokens case-insensitively and globally', () => {
		expect(replaceTokens({user: 'alice',}, 'Hi {user}, bye {USER}.',),).toBe('Hi alice, bye alice.',)
	})

	it('inserts values literally, without expanding $ replacement patterns', () => {
		// A user-controlled title with `$&`, `$'`, `` $` ``, `$$` must appear verbatim,
		// not splice in the match or surrounding template text.
		const title = `weird $& $\` $' $$ title`
		expect(replaceTokens({title,}, 'Post: {title}!',),).toBe(`Post: ${title}!`,)
		// `$1` must also stay literal (there are no capture groups to reference).
		expect(replaceTokens({body: 'see $1 here',}, '[{body}]',),).toBe('[see $1 here]',)
	})

	it('removes ASCII quotes', () => {
		expect(removeQuotes(`"quoted" and 'single'`,),).toBe('quoted and single',)
	})
})
