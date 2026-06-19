/** Tests for support module DOM helpers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const slotMock = vi.hoisted(() => ({target: null as Element | null,}))

vi.mock('../../dom/uiLocations', () => ({
	provideLocation: vi.fn((_location, target,) => {
		slotMock.target = target
		return vi.fn()
	},),
	renderAtLocation: vi.fn((_location, _options, render,) => {
		const element = render({context: {kind: 'userText',}, target: slotMock.target,},)
		if (slotMock.target && element?.type === 'div') {
			const div = document.createElement('div',)
			div.className = element.props.className
			div.textContent = element.props.children
			slotMock.target.appendChild(div,)
		}
		return vi.fn()
	},),
}),)

import {buildSubmissionAddition, createSupportHandlers,} from './dom'

const debugInfo = {
	toolboxVersion: '9.0.0',
	browser: 'Firefox',
	browserVersion: '120',
	platformInformation: 'Linux',
	debugMode: true,
	compactMode: false,
	advancedSettings: true,
	cookiesEnabled: true,
}

beforeEach(() => {
	document.body.innerHTML = ''
	slotMock.target = null
},)

describe('support module DOM helpers', () => {
	it('builds the debug submission addition from environment info', () => {
		const addition = buildSubmissionAddition(debugInfo,)

		expect(addition,).toContain('*Toolbox-NXG version*|9.0.0',)
		expect(addition,).toContain('*Browser*|Firefox',)
		expect(addition,).toContain('*Compact mode*|false',)
	})

	it('appends debug info to the submission textarea', () => {
		document.body.innerHTML = '<div class="usertext-edit md-container"><textarea>body</textarea></div>'
		const handlers = createSupportHandlers('\nDEBUG',)

		handlers.handleSubmitInsert()

		expect(document.querySelector('textarea',)?.value,).toBe('body\nDEBUG',)
	})

	it('inserts the debug button before the submit button', () => {
		document.body.innerHTML = `
            <div class="submit content">
                <button class="btn" name="submit">submit</button>
            </div>
        `
		const handlers = createSupportHandlers('DEBUG',)

		const cleanup = handlers.insertSubmitDebugButton()
		const submitButton = document.querySelector('.btn[name="submit"]',)

		expect(document.querySelector('.toolbox-insert-debug',)?.textContent,).toBe('Insert debug info',)
		expect(submitButton?.previousElementSibling?.classList.contains('toolbox-usertext-controls-slot',),).toBe(true,)
		cleanup()
	})

	it('inserts a wrapped debug button before the status element', () => {
		document.body.innerHTML = `
            <div class="usertext-edit">
                <div class="usertext-buttons">
                    <button class="save">save</button>
                    <span class="status">saved</span>
                </div>
            </div>
        `
		const handlers = createSupportHandlers('DEBUG',)

		const cleanup = handlers.insertDebugButton()
		const wrapper = document.querySelector('.toolbox-usertext-buttons',)

		expect(wrapper?.classList.contains('toolbox-usertext-buttons',),).toBe(true,)
		expect(document.querySelector('.toolbox-insert-debug',)?.textContent,).toBe('Insert debug info',)
		expect(document.querySelector('.status',)?.previousElementSibling,).toBe(wrapper,)
		cleanup()
	})

	it('inserts only the debug button before an existing toolbox button wrapper', () => {
		document.body.innerHTML = `
            <div class="usertext-edit">
                <div class="usertext-buttons">
                    <button class="save">save</button>
                    <div class="toolbox-usertext-buttons"></div>
                    <span class="status">saved</span>
                </div>
            </div>
        `
		const handlers = createSupportHandlers('DEBUG',)

		const cleanup = handlers.insertDebugButton()
		const slot = document.querySelector('.toolbox-usertext-controls-slot',)

		expect(slot?.querySelector('.toolbox-insert-debug',)?.textContent,).toBe('Insert debug info',)
		expect(document.querySelector('.toolbox-usertext-buttons',)?.previousElementSibling,).toBe(slot,)
		cleanup()
	})

	it('appends debug info to the closest comment textarea', () => {
		document.body.innerHTML = `
            <div class="usertext-edit md-container">
                <div class="md"><textarea>comment</textarea></div>
                <button class="toolbox-insert-debug"></button>
            </div>
        `
		const handlers = createSupportHandlers('\nDEBUG',)

		handlers.handleInsertDebug(document.querySelector('.toolbox-insert-debug',)!,)

		expect(document.querySelector('textarea',)?.value,).toBe('comment\nDEBUG',)
	})
})
