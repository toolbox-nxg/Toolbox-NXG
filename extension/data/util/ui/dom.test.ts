/** Tests for DOM utilities. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

import {delegate, html, onDOMAttach, qs, qsa,} from './dom'

beforeEach(() => {
	document.body.innerHTML = ''
},)

describe('DOM utilities', () => {
	it('queries one or many elements from a parent', () => {
		document.body.innerHTML = '<section><span class="item">one</span><span class="item">two</span></section>'
		const section = qs<HTMLElement>('section',)!

		expect(qs('.item', section,)?.textContent,).toBe('one',)
		expect(qsa('.item', section,).map((element,) => element.textContent),).toEqual(['one', 'two',],)
	})

	it('creates an element from a single-root HTML string', () => {
		const element = html<HTMLButtonElement>('  <button type="button">Click</button>  ',)

		expect(element.tagName,).toBe('BUTTON',)
		expect(element.textContent,).toBe('Click',)
		expect(element.type,).toBe('button',)
	})

	it('delegates bubbled events to matching descendants', () => {
		document.body.innerHTML = '<div id="parent"><button class="action"><span>inner</span></button></div>'
		const handler = vi.fn()
		delegate(document.querySelector('#parent',)!, 'click', '.action', handler,)

		document.querySelector('span',)!.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)

		expect(handler,).toHaveBeenCalledOnce()
		expect(handler.mock.calls[0]![0],).toBe(document.querySelector('.action',),)
	})

	it('delegates composed events from shadow DOM descendants', () => {
		const host = document.createElement('div',)
		const shadow = host.attachShadow({mode: 'open',},)
		shadow.innerHTML = '<button class="action"><span>inner</span></button>'
		document.body.appendChild(host,)
		const handler = vi.fn()
		delegate(document.body, 'click', '.action', handler,)

		shadow.querySelector('span',)!.dispatchEvent(new MouseEvent('click', {bubbles: true, composed: true,},),)

		expect(handler,).toHaveBeenCalledOnce()
		expect(handler.mock.calls[0]![0],).toBe(shadow.querySelector('.action',),)
	})

	it('runs onDOMAttach handlers when an element is inserted', async () => {
		const element = document.createElement('div',)
		const handler = vi.fn()

		onDOMAttach(element, handler,)
		document.body.appendChild(element,)
		await Promise.resolve()

		expect(handler,).toHaveBeenCalledOnce()
	})
})
