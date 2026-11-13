/** Tests for the custom CSS store that feeds the page head and Toolbox shadow roots. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

type UserStyles = typeof import('./userStyles')

let userStyles: UserStyles

// The module keeps its CSS and copies in module state, so each test gets a fresh instance.
beforeEach(async () => {
	vi.resetModules()
	userStyles = await import('./userStyles')
},)

afterEach(() => {
	document.head.innerHTML = ''
	document.body.innerHTML = ''
},)

function makeShadowRoot () {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	return host.attachShadow({mode: 'open',},)
}

describe('page head copy', () => {
	it('adds a style element to the head with the CSS', () => {
		userStyles.setUserCss('a { color: red; }',)
		const style = userStyles.getDocumentUserStyleElement()
		expect(style?.parentNode,).toBe(document.head,)
		expect(style?.textContent,).toBe('a { color: red; }',)
	})

	it('updates the same element on later changes', () => {
		userStyles.setUserCss('a { color: red; }',)
		const first = userStyles.getDocumentUserStyleElement()
		userStyles.setUserCss('a { color: blue; }',)
		expect(userStyles.getDocumentUserStyleElement(),).toBe(first,)
		expect(document.head.querySelectorAll('style[data-toolbox-user-css]',),).toHaveLength(1,)
		expect(first?.textContent,).toBe('a { color: blue; }',)
	})

	it('removes the element when the CSS is cleared', () => {
		userStyles.setUserCss('a { color: red; }',)
		userStyles.setUserCss('',)
		expect(userStyles.getDocumentUserStyleElement(),).toBeNull()
		expect(document.head.querySelector('style[data-toolbox-user-css]',),).toBeNull()
	})

	it('adds nothing to the head while the CSS is empty', () => {
		userStyles.setUserCss('',)
		expect(document.head.querySelector('style',),).toBeNull()
	})
})

describe('adopted sheet', () => {
	it('starts with the current CSS', () => {
		userStyles.setUserCss('a { color: red; }',)
		const sheet = userStyles.getUserStyleSheet()
		expect(sheet?.cssRules[0]?.cssText,).toBe('a { color: red; }',)
	})

	it('is shared and follows later changes', () => {
		const sheet = userStyles.getUserStyleSheet()
		expect(userStyles.getUserStyleSheet(),).toBe(sheet,)
		userStyles.setUserCss('b { color: blue; }',)
		expect(sheet?.cssRules[0]?.cssText,).toBe('b { color: blue; }',)
	})
})

describe('fallback style elements', () => {
	it('appends a copy of the current CSS to the shadow root', () => {
		userStyles.setUserCss('a { color: red; }',)
		const root = makeShadowRoot()
		userStyles.appendUserStyleElement(root,)
		expect(root.querySelector('style[data-toolbox-user-css]',)?.textContent,).toBe('a { color: red; }',)
	})

	it('updates every copy, including ones added before any CSS was set', () => {
		const early = makeShadowRoot()
		userStyles.appendUserStyleElement(early,)
		const late = makeShadowRoot()
		userStyles.appendUserStyleElement(late,)

		userStyles.setUserCss('a { color: red; }',)

		for (const root of [early, late,]) {
			expect(root.querySelector('style[data-toolbox-user-css]',)?.textContent,).toBe('a { color: red; }',)
		}
	})

	it('empties copies when the CSS is cleared', () => {
		userStyles.setUserCss('a { color: red; }',)
		const root = makeShadowRoot()
		userStyles.appendUserStyleElement(root,)
		userStyles.setUserCss('',)
		expect(root.querySelector('style[data-toolbox-user-css]',)?.textContent,).toBe('',)
	})
})
