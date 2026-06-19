/** Tests for reddit-domain utilities. */

import {describe, expect, it,} from 'vitest'

import {cleanSubredditName, stringToColor, title_to_url,} from './reddit-domain'

describe('reddit-domain utilities', () => {
	it('converts titles to reddit-style URL slugs', () => {
		expect(title_to_url('  Hello, World! This is a test.  ',),).toBe('hello_world_this_is_a_test',)
		expect(title_to_url('!!!',),).toBe('_',)
		expect(title_to_url('one two three four five six seven eight nine ten eleven twelve',),).toBe(
			'one_two_three_four_five_six_seven_eight_nine_ten',
		)
	})

	it('cleans common subreddit prefixes and adornments', () => {
		expect(cleanSubredditName('/r/toolbox/',),).toBe('toolbox',)
		expect(cleanSubredditName('r/toolbox',),).toBe('toolbox',)
		expect(cleanSubredditName('+ toolbox −',),).toBe('toolbox',)
	})

	it('generates a deterministic hex color for a string', () => {
		expect(stringToColor('toolbox',),).toMatch(/^#[0-9a-f]{6}$/,)
		expect(stringToColor('toolbox',),).toBe(stringToColor('toolbox',),)
		expect(stringToColor('toolbox',),).not.toBe(stringToColor('reddit',),)
	})
})
