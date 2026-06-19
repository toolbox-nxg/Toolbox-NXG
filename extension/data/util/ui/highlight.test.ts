/** Tests for highlight. */

import {beforeEach, describe, expect, it,} from 'vitest'

import {highlight, removeHighlight,} from './highlight'

beforeEach(() => {
	document.body.innerHTML = ''
},)

describe('highlight', () => {
	it('wraps matching text in highlight spans', () => {
		document.body.innerHTML = '<p>Hello Toolbox world</p>'
		const p = document.querySelector('p',)!

		highlight(p, 'toolbox',)

		expect(p.innerHTML,).toBe('Hello <span class="toolbox-highlight">Toolbox</span> world',)
	})

	it('can ignore diacritics while matching', () => {
		document.body.innerHTML = '<p>Café moderation</p>'
		const p = document.querySelector('p',)!

		highlight(p, 'cafe', true,)

		expect(p.querySelector('.toolbox-highlight',)?.textContent,).toBe('Café',)
	})

	it('uses action-reason highlight class when requested', () => {
		document.body.innerHTML = '<p>remove this</p>'
		const p = document.querySelector('p',)!

		highlight(p, 'remove', false, true,)

		expect(p.querySelector('.toolbox-highlight-action-reason',)?.textContent,).toBe('remove',)
	})

	it('skips scripts and usertext edit parents', () => {
		document.body.innerHTML = `
            <div class="usertext-edit"><p>Toolbox</p></div>
            <section><script>Toolbox</script><p>Toolbox</p></section>
        `

		highlight(document.querySelector('.usertext-edit p',)!, 'Toolbox',)
		highlight(document.querySelector('section',)!, 'Toolbox',)

		expect(document.querySelector('.usertext-edit .toolbox-highlight',),).toBeNull()
		expect(document.querySelector('script .toolbox-highlight',),).toBeNull()
		expect(document.querySelector('section p .toolbox-highlight',),).not.toBeNull()
	})

	it('removes highlight spans and restores text', () => {
		document.body.innerHTML = '<p>Hello Toolbox world</p>'
		const p = document.querySelector('p',)!
		highlight(p, 'Toolbox',)

		removeHighlight(p,)

		expect(p.innerHTML,).toBe('Hello Toolbox world',)
	})
})
