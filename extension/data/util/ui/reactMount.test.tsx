/** Tests for mountToTarget. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// Mock webextension-polyfill so browser.runtime.getURL works in jsdom.
vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)

// Mock react-dom/client createRoot to avoid JSDOM React rendering limitations.
const unmountMock = vi.fn()
const renderMock = vi.fn()
vi.mock('react-dom/client', () => ({
	createRoot: () => ({render: renderMock, unmount: unmountMock,}),
}),)

// Mock ./dom onDOMAttach (used by reactRenderer) - call the callback immediately.
vi.mock('./dom', () => ({
	onDOMAttach: (_element: unknown, cb: () => void,) => cb(),
	delegate: vi.fn(),
}),)

import {createLifecycle,} from '../../framework/lifecycle'
import {mountToTarget,} from './reactMount'

afterEach(() => {
	document.body.innerHTML = ''
	vi.clearAllMocks()
},)

describe('mountToTarget', () => {
	let target: HTMLElement

	beforeEach(() => {
		target = document.createElement('div',)
		document.body.appendChild(target,)
	},)

	it('appends a shadow host to target', () => {
		mountToTarget(<></>, target,)
		const host = target.querySelector('.toolbox-react-shadow-host',)
		expect(host,).not.toBeNull()
	})

	it('calls render on the created root', () => {
		mountToTarget(<></>, target,)
		expect(renderMock,).toHaveBeenCalledOnce()
	})

	it('sets data-toolbox-mount when key is given', () => {
		mountToTarget(<></>, target, {key: 'my-key',},)
		const host = target.querySelector('[data-toolbox-mount="my-key"]',)
		expect(host,).not.toBeNull()
	})

	it('removes existing host with same key before mounting (idempotent)', () => {
		mountToTarget(<></>, target, {key: 'dup',},)
		mountToTarget(<></>, target, {key: 'dup',},)
		expect(target.querySelectorAll('[data-toolbox-mount="dup"]',),).toHaveLength(1,)
	})

	it('does not remove hosts with a different key', () => {
		mountToTarget(<></>, target, {key: 'a',},)
		mountToTarget(<></>, target, {key: 'b',},)
		expect(target.querySelectorAll('.toolbox-react-shadow-host',),).toHaveLength(2,)
	})

	it('returns a cleanup that removes the host', () => {
		const cleanup = mountToTarget(<></>, target,)
		expect(target.children,).toHaveLength(1,)
		cleanup()
		expect(target.children,).toHaveLength(0,)
	})

	it('returned cleanup calls unmount on the React root', () => {
		const cleanup = mountToTarget(<></>, target,)
		cleanup()
		expect(unmountMock,).toHaveBeenCalledOnce()
	})

	it('registers cleanup with lifecycle when provided', async () => {
		const lc = createLifecycle()
		mountToTarget(<></>, target, {lifecycle: lc,},)
		expect(target.children,).toHaveLength(1,)
		await lc.cleanup()
		expect(target.children,).toHaveLength(0,)
	})

	it('creates a light-DOM host when shadow=false', () => {
		mountToTarget(<></>, target, {shadow: false,},)
		const host = target.querySelector('.toolbox-react-light-host',)
		expect(host,).not.toBeNull()
		// no shadow root in light mode
		expect((host as HTMLElement).shadowRoot,).toBeNull()
	})
})
