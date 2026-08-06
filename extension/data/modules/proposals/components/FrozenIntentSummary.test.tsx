/** Tests that the "what happens on accept" panel surfaces the captured intent. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it,} from 'vitest'

import type {FrozenRemovalIntent, ProposedAction,} from '../../../util/wiki/schemas/proposals/schema'
import {FrozenIntentSummary,} from './FrozenIntentSummary'

let container: HTMLDivElement
let root: Root

/** Renders the summary for an action and returns the container's text content. */
function renderText (action: ProposedAction,): string {
	act(() => {
		root.render(<FrozenIntentSummary action={action} />,)
	},)
	return container.textContent ?? ''
}

/** A frozen removal intent with the given overrides on top of the required fields. */
function intent (overrides: Partial<FrozenRemovalIntent> = {},): FrozenRemovalIntent {
	return {reasonText: 'This is the reason.', reasonType: 'reply', subject: '', ...overrides,}
}

beforeEach(() => {
	container = document.createElement('div',)
	document.body.appendChild(container,)
	root = createRoot(container,)
},)

afterEach(() => {
	act(() => root.unmount())
	container.remove()
},)

describe('FrozenIntentSummary (removal-reason)', () => {
	it('renders the composed reason text and the delivery mode', () => {
		const text = renderText({type: 'removal-reason', intent: intent(),},)
		expect(text,).toContain('This is the reason.',)
		expect(text,).toContain('Reply on the thread',)
	})

	it('shows the selected reason template title when captured', () => {
		const text = renderText({type: 'removal-reason', intent: intent({reasonTitle: 'Rule 3: Low effort',},),},)
		expect(text,).toContain('Rule 3: Low effort',)
	})

	it('shows every captured side effect that is present', () => {
		const text = renderText({
			type: 'removal-reason',
			intent: intent({
				reasonType: 'both',
				subject: 'Your post was removed',
				flair: {text: 'Removed',},
				usernote: {text: 'spammer', type: 'spamwatch',},
				ban: {permanent: false, days: 3, note: 'first strike',},
				logSub: 'modlog',
				actionLockThread: true,
			},),
		},)
		expect(text,).toContain('Your post was removed',)
		expect(text,).toContain('Removed',)
		expect(text,).toContain('spammer',)
		expect(text,).toContain('3d',)
		expect(text,).toContain('r/modlog',)
		expect(text,).toContain('Lock thread',)
	})

	it('names the note\'s destination, so the reviewer knows which store it lands in', () => {
		const toolbox = renderText({
			type: 'removal-reason',
			intent: intent({usernote: {text: 'spammer', type: 'spamwatch',},},),
		},)
		expect(toolbox,).toContain('Toolbox note',)
		expect(toolbox,).not.toContain('Reddit mod note',)

		const native = renderText({
			type: 'removal-reason',
			intent: intent({
				// `type` is the Toolbox vocabulary and is not what gets applied here; the
				// review must show the Reddit label instead of it.
				usernote: {text: 'spammer', type: 'spamwatch', destination: 'native', nativeLabel: 'PERMA_BAN',},
			},),
		},)
		expect(native,).toContain('Reddit mod note',)
		expect(native,).toContain('Permaban',)
		expect(native,).not.toContain('spamwatch',)
	})

	it('shows a native note with no label as simply unlabelled', () => {
		const text = renderText({
			type: 'removal-reason',
			intent: intent({usernote: {text: 'watch this one', destination: 'native',},},),
		},)
		expect(text,).toContain('Reddit mod note',)
		expect(text,).toContain('watch this one',)
	})

	it('omits side effects that are absent (no flair/usernote/ban)', () => {
		const text = renderText({type: 'removal-reason', intent: intent(),},)
		expect(text,).not.toContain('Flair',)
		expect(text,).not.toContain('Usernote',)
		expect(text,).not.toContain('Ban',)
	})
})

describe('FrozenIntentSummary (user actions)', () => {
	it('shows ban duration, mod note, and message', () => {
		const text = renderText({type: 'ban', permanent: true, days: 0, note: 'evasion', message: 'goodbye',},)
		expect(text,).toContain('Permanent',)
		expect(text,).toContain('evasion',)
		expect(text,).toContain('goodbye',)
	})

	it('renders nothing for an action whose label already says everything', () => {
		expect(renderText({type: 'approve',},).trim(),).toBe('',)
	})
})
