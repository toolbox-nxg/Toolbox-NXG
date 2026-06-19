/** Tests for removal reason parser. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const snuownd = vi.hoisted(() => ({
	DEFAULT_HTML_ELEMENT_WHITELIST: ['a',],
	DEFAULT_HTML_ATTR_WHITELIST: ['href',],
	DEFAULT_BODY_FLAGS: 1,
	HTML_ALLOW_ELEMENT_WHITELIST: 2,
	getRedditRenderer: vi.fn((flags: number,) => ({flags, context: {},})),
	getParser: vi.fn((renderer: unknown,) => ({renderer,})),
}))

vi.mock('snuownd', () => ({default: snuownd,}),)

import {getRemovalReasonParser,} from './parser'

describe('removal reason parser', () => {
	beforeEach(() => {
		snuownd.DEFAULT_HTML_ELEMENT_WHITELIST.splice(0, Infinity, 'a',)
		snuownd.DEFAULT_HTML_ATTR_WHITELIST.splice(0, Infinity, 'href',)
		snuownd.getRedditRenderer.mockClear()
		snuownd.getParser.mockClear()
	},)

	it('extends the renderer context whitelist with form-related elements and attributes', () => {
		getRemovalReasonParser()

		const renderer = snuownd.getRedditRenderer.mock.results[0]!.value as {
			context: {html_element_whitelist: string[]; html_attr_whitelist: string[]}
		}
		expect(renderer.context.html_element_whitelist,).toEqual(['a', 'select', 'option', 'textarea', 'input',],)
		expect(renderer.context.html_attr_whitelist,).toEqual(['href', 'id', 'placeholder', 'label', 'value',],)
	})

	it('does not mutate the global default whitelists', () => {
		getRemovalReasonParser()
		getRemovalReasonParser()

		expect(snuownd.DEFAULT_HTML_ELEMENT_WHITELIST,).toEqual(['a',],)
		expect(snuownd.DEFAULT_HTML_ATTR_WHITELIST,).toEqual(['href',],)
	})

	it('creates a reddit renderer with whitelist flags and returns its parser', () => {
		const parser = getRemovalReasonParser()

		expect(snuownd.getRedditRenderer,).toHaveBeenCalledWith(3,)
		const renderer = snuownd.getRedditRenderer.mock.results[0]!.value
		expect(snuownd.getParser,).toHaveBeenCalledWith(renderer,)
		expect(parser,).toEqual({renderer,},)
	})
})
