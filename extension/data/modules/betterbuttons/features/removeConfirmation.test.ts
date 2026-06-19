/** Tests for remove confirmation handlers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getSettingAsync = vi.hoisted(() => vi.fn())

vi.mock('../../../util/infra/logging', () => ({default: () => ({debug: vi.fn(),}),}),)
vi.mock('../../../util/persistence/settings', () => ({getSettingAsync,}),)
vi.mock('../../../framework/moduleIds', () => ({removalReasons: 'removalreasons',}),)

import {createRemoveConfirmationHandlers,} from './removeConfirmation'

beforeEach(() => {
	document.body.innerHTML = ''
	document.body.className = ''
	getSettingAsync.mockReset()
},)

describe('remove confirmation handlers', () => {
	it('confirms approve buttons immediately', () => {
		document.body.innerHTML = `
            <span class="approve-button">
                <button class="togglebutton">approve</button>
                <button class="yes">yes</button>
            </span>
        `
		const yes = document.querySelector<HTMLElement>('.yes',)!
		const click = vi.spyOn(yes, 'click',)

		createRemoveConfirmationHandlers().handleApproveClick(document.querySelector('.togglebutton',)!,)

		expect(click,).toHaveBeenCalledOnce()
	})

	it('confirms remove clicks when removal reasons are not active', async () => {
		document.body.innerHTML = `
            <span class="remove-button">
                <button class="togglebutton">remove</button>
                <button class="yes">yes</button>
            </span>
        `
		const yes = document.querySelector<HTMLElement>('.yes',)!
		const click = vi.spyOn(yes, 'click',)

		await createRemoveConfirmationHandlers().handleRemoveClick(document.querySelector('.togglebutton',)!,)

		expect(click,).toHaveBeenCalledOnce()
		expect(getSettingAsync,).not.toHaveBeenCalled()
	})

	it('does not auto-confirm regular removes when comment removal reasons are enabled', async () => {
		document.body.classList.add('toolbox-removal-reasons',)
		getSettingAsync.mockResolvedValue(true,)
		document.body.innerHTML = `
            <span class="remove-button">
                <input value="removed">
                <button class="togglebutton">remove</button>
                <button class="yes">yes</button>
            </span>
        `
		const yes = document.querySelector<HTMLElement>('.yes',)!
		const click = vi.spyOn(yes, 'click',)

		await createRemoveConfirmationHandlers().handleRemoveClick(document.querySelector('.togglebutton',)!,)

		expect(getSettingAsync,).toHaveBeenCalledWith('removalreasons', 'commentReasons',)
		expect(click,).not.toHaveBeenCalled()
	})

	it('still auto-confirms spam buttons when removal reasons are enabled', async () => {
		document.body.classList.add('toolbox-removal-reasons',)
		getSettingAsync.mockResolvedValue(true,)
		document.body.innerHTML = `
            <span class="remove-button">
                <input value="spammed">
                <button class="togglebutton">spam</button>
                <button class="yes">yes</button>
            </span>
        `
		const yes = document.querySelector<HTMLElement>('.yes',)!
		const click = vi.spyOn(yes, 'click',)

		await createRemoveConfirmationHandlers().handleRemoveClick(document.querySelector('.togglebutton',)!,)

		expect(click,).toHaveBeenCalledOnce()
	})
})
