/** Tests for tagToolboxContainer: marker tagging and idempotency. */

import {beforeEach, describe, expect, it,} from 'vitest'

import {tagToolboxContainer,} from './toolboxContainer'

describe('tagToolboxContainer', () => {
	beforeEach(() => {
		document.body.innerHTML = ''
	},)

	it('tags the inner marker span with the class and data-toolbox-type', () => {
		const container = document.createElement('span',)
		container.innerHTML = '<span data-name="toolbox"></span>'

		tagToolboxContainer(container, 'TBcommentAuthor',)

		const marker = container.querySelector('[data-name="toolbox"]',)!
		expect(marker.classList.contains('toolbox-frontend-container',),).toBe(true,)
		expect(marker.getAttribute('data-toolbox-type',),).toBe('TBcommentAuthor',)
	})

	it('is a no-op when there is no marker span', () => {
		const container = document.createElement('span',)
		expect(() => tagToolboxContainer(container, 'TBpost',)).not.toThrow()
		expect(container.querySelector('.toolbox-frontend-container',),).toBeNull()
	})

	it('does not re-tag a marker that is already tagged', () => {
		const container = document.createElement('span',)
		container.innerHTML = '<span data-name="toolbox"></span>'

		tagToolboxContainer(container, 'TBpostAuthor',)
		// A second call with a different type must not overwrite the first.
		tagToolboxContainer(container, 'TBcommentAuthor',)

		const marker = container.querySelector('[data-name="toolbox"]',)!
		expect(marker.getAttribute('data-toolbox-type',),).toBe('TBpostAuthor',)
	})
})
