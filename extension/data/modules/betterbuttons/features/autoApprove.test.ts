/** Tests for auto approve handlers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('../../../util/infra/logging', () => ({default: () => ({debug: vi.fn(),}),}),)

import {createAutoApproveHandlers,} from './autoApprove'

beforeEach(() => {
	document.body.innerHTML = ''
},)

describe('auto approve handlers', () => {
	it('clicks the sibling positive button when ignore reports is pressed', () => {
		document.body.innerHTML = `
            <div>
                <span><button class="positive">approve</button></span>
                <button class="ignore">ignore reports</button>
            </div>
        `
		const positive = document.querySelector<HTMLElement>('.positive',)!
		const click = vi.spyOn(positive, 'click',)

		createAutoApproveHandlers().handleIgnoreClick(document.querySelector('.ignore',)!,)

		expect(click,).toHaveBeenCalledOnce()
	})

	it('does not click an already pressed positive button', () => {
		document.body.innerHTML = `
            <div>
                <span><button class="positive pressed">approve</button></span>
                <button class="ignore">ignore reports</button>
            </div>
        `
		const positive = document.querySelector<HTMLElement>('.positive',)!
		const click = vi.spyOn(positive, 'click',)

		createAutoApproveHandlers().handleIgnoreClick(document.querySelector('.ignore',)!,)

		expect(click,).not.toHaveBeenCalled()
	})
})
