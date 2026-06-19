/** Tests for TBSubmission. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, describe, expect, it, vi,} from 'vitest'

const runtime = vi.hoisted(() => ({sendMessage: vi.fn(), getURL: vi.fn(() => ''),}))

vi.mock('webextension-polyfill', () => ({default: {runtime,},}),)
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import {TBSubmission,} from './TBSubmission'

const roots: Root[] = []

function render (ui: React.ReactNode,): HTMLElement {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	act(() => {
		root.render(ui,)
	},)
	return host
}

function submission (extra: Record<string, unknown> = {},) {
	return {
		kind: 't3',
		data: {
			name: 't3_abc',
			title: 'Example post',
			subreddit: 'toolbox',
			subreddit_type: 'public',
			author: 'alice',
			created_utc: 1700000000,
			permalink: '/r/toolbox/comments/abc/example/',
			url: 'https://example.com',
			domain: 'example.com',
			is_self: false,
			thumbnail: 'self',
			score: 1,
			likes: null,
			num_comments: 2,
			can_mod_post: false,
			user_reports: [],
			mod_reports: [],
			gildings: {},
			...extra,
		},
	}
}

afterEach(() => {
	for (const root of roots.splice(0,)) {
		act(() => root.unmount())
	}
	document.body.innerHTML = ''
	runtime.sendMessage.mockReset()
},)

describe('TBSubmission', () => {
	it('renders post flair only when enabled by submission options', () => {
		const withFlair = submission({
			link_flair_text: 'Announcement',
			link_flair_css_class: 'mod-post',
			link_flair_background_color: '#336699',
			link_flair_text_color: 'light',
		},)

		const disabled = render(<TBSubmission submission={withFlair} subredditColorSalt="salt" />,)
		expect(disabled.querySelector('.toolbox-post-flair',),).toBeNull()

		const enabled = render(
			<TBSubmission submission={withFlair} options={{showPostFlair: true,}} subredditColorSalt="salt" />,
		)
		const flair = enabled.querySelector<HTMLElement>('.toolbox-post-flair',)

		expect(flair?.textContent,).toBe('Announcement',)
		expect(flair?.classList.contains('toolbox-submission-flair',),).toBe(true,)
		expect(flair?.classList.contains('mod-post',),).toBe(true,)
		expect(flair?.style.backgroundColor,).toBe('#336699',)
		expect(flair?.style.color,).toBe('#FFFFFF',)
	})
})
