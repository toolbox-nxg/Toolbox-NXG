/** Tests for the old-Reddit mod-save distinguish/sticky composer toggles. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// The distinguish routes through the proposals gateway; mock it (the real module pulls in the wiki
// transport + webextension polyfill, which throws outside a browser). uiLocations is stubbed for the
// same reason - the render callback is captured and invoked directly instead.
const proposeOrDistinguish = vi.hoisted(() => vi.fn(() => Promise.resolve('performed',)))
const renderAtLocation = vi.hoisted(() => vi.fn(() => () => {}))
const provideLocation = vi.hoisted(() => vi.fn(() => () => {}))

vi.mock('../../shared/proposals/gateway', () => ({proposeOrDistinguish,}),)
vi.mock('../../../dom/uiLocations', () => ({renderAtLocation, provideLocation,}),)
vi.mock('../../../util/infra/logging', () => ({
	default: () => ({error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn(),}),
}),)
// reactMount pulls in the webextension polyfill; only `classes` is needed here.
vi.mock('../../../util/ui/reactMount', () => ({
	classes: (...stuff: unknown[]) => stuff.flat().filter(Boolean,).join(' ',),
}),)

import {createModSaveHandlers,} from './modSave'

const cleanups: Array<() => void> = []

/**
 * Creates the handlers and registers their teardown. Required for isolation: each factory starts a
 * MutationObserver on `document.body`, so one left running would also fire on the next test's DOM.
 */
function createHandlers () {
	const handlers = createModSaveHandlers()
	cleanups.push(handlers.cleanup,)
	return handlers
}

const distinguishClass = 'toolbox-mod-distinguish-toggle'
const stickyClass = 'toolbox-mod-sticky-toggle'

/**
 * Builds an old-Reddit comment composer matching the selector modSave injects into, plus the two
 * toggles it renders (built directly, since the React render is stubbed out here).
 */
function makeComposer () {
	document.body.className = 'moderator'
	document.body.innerHTML = `
		<div class="commentarea">
			<form class="usertext cloneable">
				<div class="usertext-edit">
					<div class="usertext-buttons">
						<button class="save">save</button>
						<label><input type="checkbox" class="${distinguishClass}"></label>
						<label><input type="checkbox" class="${stickyClass}"></label>
					</div>
				</div>
			</form>
		</div>`
	const form = document.querySelector('form',)!
	return {
		form,
		save: form.querySelector<HTMLButtonElement>('button.save',)!,
		distinguish: form.querySelector<HTMLInputElement>(`.${distinguishClass}`,)!,
		sticky: form.querySelector<HTMLInputElement>(`.${stickyClass}`,)!,
	}
}

/** Appends a saved comment thing, the way Reddit does once a reply posts. */
function appendSavedComment () {
	const comment = document.createElement('div',)
	comment.className = 'comment'
	comment.setAttribute('data-fullname', 't1_new',)
	comment.setAttribute('data-subreddit', 'testsub',)
	document.querySelector('.commentarea',)!.appendChild(comment,)
	return comment
}

/** Lets the MutationObserver callback and the async gateway call settle. */
async function flush () {
	await new Promise((resolve,) => setTimeout(resolve, 0,))
	await Promise.resolve()
}

beforeEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ''
	document.body.className = ''
},)

afterEach(() => {
	while (cleanups.length) { cleanups.pop()!() }
},)

describe('createModSaveHandlers', () => {
	describe('handleToggleChange', () => {
		it('unchecks "distinguish" when "sticky" is switched on', () => {
			const {distinguish, sticky,} = makeComposer()
			const {handleToggleChange,} = createHandlers()

			distinguish.checked = true
			sticky.checked = true
			handleToggleChange(sticky,)

			expect(distinguish.checked,).toBe(false,)
			expect(sticky.checked,).toBe(true,)
		})

		it('unchecks "sticky" when "distinguish" is switched on', () => {
			const {distinguish, sticky,} = makeComposer()
			const {handleToggleChange,} = createHandlers()

			sticky.checked = true
			distinguish.checked = true
			handleToggleChange(distinguish,)

			expect(sticky.checked,).toBe(false,)
			expect(distinguish.checked,).toBe(true,)
		})

		it('leaves the partner alone when a toggle is switched off', () => {
			const {distinguish, sticky,} = makeComposer()
			const {handleToggleChange,} = createHandlers()

			sticky.checked = true
			distinguish.checked = false
			handleToggleChange(distinguish,)

			expect(sticky.checked,).toBe(true,)
		})
	})

	describe('handleSaveClick', () => {
		it('stays out of the way when neither toggle is set', async () => {
			const {save,} = makeComposer()
			const {handleSaveClick,} = createHandlers()

			handleSaveClick(save,)
			appendSavedComment()
			await flush()

			expect(proposeOrDistinguish,).not.toHaveBeenCalled()
		})

		it('distinguishes the saved comment without stickying it', async () => {
			const {save, distinguish,} = makeComposer()
			const {handleSaveClick,} = createHandlers()

			distinguish.checked = true
			handleSaveClick(save,)
			appendSavedComment()
			await flush()

			expect(proposeOrDistinguish,).toHaveBeenCalledWith(
				{subreddit: 'testsub', itemId: 't1_new', itemKind: 'comment',},
				false,
			)
		})

		it('distinguishes and stickies when the sticky toggle is set', async () => {
			const {save, sticky,} = makeComposer()
			const {handleSaveClick,} = createHandlers()

			sticky.checked = true
			handleSaveClick(save,)
			appendSavedComment()
			await flush()

			expect(proposeOrDistinguish,).toHaveBeenCalledWith(
				expect.objectContaining({itemId: 't1_new',},),
				true,
			)
		})

		it('resets both toggles so the next reply starts clean', () => {
			const {save, sticky,} = makeComposer()
			const {handleSaveClick,} = createHandlers()

			sticky.checked = true
			handleSaveClick(save,)

			expect(sticky.checked,).toBe(false,)
		})

		it('acts only on the first saved comment, not later ones', async () => {
			const {save, sticky,} = makeComposer()
			const {handleSaveClick,} = createHandlers()

			sticky.checked = true
			handleSaveClick(save,)
			appendSavedComment()
			await flush()
			appendSavedComment()
			await flush()

			expect(proposeOrDistinguish,).toHaveBeenCalledTimes(1,)
		})
	})

	it('injects the controls into the comment composer, not a post edit form', () => {
		// A post edit form precedes the reply box on your own post; the old first-match query landed
		// there, hiding both controls inside a form Reddit keeps collapsed.
		document.body.className = 'moderator'
		document.body.innerHTML = `
			<form class="usertext" id="edit-form">
				<div class="usertext-edit"><div class="usertext-buttons"><button class="save"></button></div></div>
			</form>
			<div class="commentarea">
				<form class="usertext cloneable">
					<div class="usertext-edit"><div class="usertext-buttons"><button class="save"></button></div></div>
				</form>
			</div>`

		createHandlers()

		const slot = document.querySelector('.toolbox-comment-composer-controls-slot',)
		expect(slot,).toBeTruthy()
		expect(slot!.closest('form',)?.id,).not.toBe('edit-form',)
		expect(slot!.closest('.commentarea',),).toBeTruthy()
	})
})
