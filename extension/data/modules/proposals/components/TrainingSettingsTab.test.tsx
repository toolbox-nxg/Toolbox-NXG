/** Tests for the Training settings tab's save logic (trainee toggles, preserve-unlisted, clamp). */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {sendMessage: vi.fn(), getURL: (path: string,) => path,},},
}),)

const getSubredditListing = vi.hoisted(() => vi.fn())
vi.mock('../../../api/resources/subreddits', () => ({getSubredditListing,}),)

// Resolve the current user for the seniority guard. Defaults to a name not on the mod
// list, so the guard fails open (no locking) and the save-logic tests below are unaffected.
const getCurrentUser = vi.hoisted(() => vi.fn(() => Promise.resolve('',)))
vi.mock('../../../api/resources/me', () => ({getCurrentUser,}),)

const resolveWikiLayout = vi.hoisted(() => vi.fn())
vi.mock('../../../util/wiki/wikiPaths', () => ({
	resolveWikiLayout,
	compatMirrorEnabled: (layout: {compatibilityWrites?: boolean},) => !!layout.compatibilityWrites,
}),)

const positiveTextFeedback = vi.hoisted(() => vi.fn())
vi.mock('../../../store/feedback', () => ({positiveTextFeedback,}),)

import type {SaveRef,} from '../../../util/ui/hooks'
import {TrainingSettingsTab,} from './TrainingSettingsTab'

let container: HTMLDivElement
let root: Root

/** Mounts the tab with the given config and returns the save trigger + onSave spy. */
async function renderTab (config: Record<string, unknown>,) {
	const saveRef: SaveRef = {current: null,}
	const onSave = vi.fn()
	const state = {config, subreddit: 'sub', postFlairTemplates: null, userFlairTemplates: null,}
	await act(async () => {
		root.render(<TrainingSettingsTab state={state as never} saveRef={saveRef} onSave={onSave} />,)
	},)
	// Let the moderator-list effect resolve.
	await act(async () => {
		await Promise.resolve()
	},)
	return {saveRef, onSave,}
}

/** Sets a controlled input's value the way React expects, then fires `input`. */
function setInputValue (el: HTMLInputElement, value: string,) {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value',)!.set!
	setter.call(el, value,)
	el.dispatchEvent(new Event('input', {bubbles: true,},),)
}

beforeEach(() => {
	vi.clearAllMocks()
	resolveWikiLayout.mockResolvedValue({state: 'nxg', compatibilityWrites: false,},)
	getSubredditListing.mockResolvedValue({
		data: {children: [{name: 'ExistingTrainee', mod_permissions: [],}, {name: 'NewMod', mod_permissions: [],},],},
	},)
	container = document.createElement('div',)
	document.body.appendChild(container,)
	root = createRoot(container,)
},)

afterEach(() => {
	act(() => root.unmount())
	container.remove()
},)

describe('TrainingSettingsTab save', () => {
	it('toggles trainees and preserves a configured mod not in the listing', async () => {
		const config: Record<string, unknown> = {
			trainingMods: ['existingtrainee', 'GhostMod',], // GhostMod is not in the listing
			proposalRetentionDays: 30,
		}
		const {saveRef, onSave,} = await renderTab(config,)

		// The moderator toggles render first, followed by the "Actions to guard" group
		// toggles (present here because trainees are configured), so target the mod rows
		// by their `u/<name>` labels rather than asserting a fixed total checkbox count.
		const modCheckbox = (name: string,) =>
			[...container.querySelectorAll<HTMLLabelElement>('label',),]
				.find((l,) => l.textContent?.includes(`u/${name}`,))!
				.querySelector<HTMLInputElement>('input[type="checkbox"]',)!
		// ExistingTrainee starts checked (case-insensitive match), NewMod unchecked.
		expect(modCheckbox('ExistingTrainee',).checked,).toBe(true,)
		expect(modCheckbox('NewMod',).checked,).toBe(false,)

		await act(async () => {
			modCheckbox('ExistingTrainee',).click() // uncheck ExistingTrainee
			modCheckbox('NewMod',).click() // check NewMod
		},)
		await act(async () => {
			saveRef.current?.()
		},)

		expect(onSave,).toHaveBeenCalledOnce()
		const saved = onSave.mock.calls[0]![0] as {trainingMods: string[]; proposalRetentionDays: number}
		// NewMod selected (canonical case from the listing); GhostMod preserved; retention unchanged.
		expect(saved.trainingMods.sort(),).toEqual(['GhostMod', 'NewMod',],)
		expect(saved.proposalRetentionDays,).toBe(30,)
		expect(positiveTextFeedback,).toHaveBeenCalled()
	})

	it('clamps the retention window to the allowed range', async () => {
		const {saveRef, onSave,} = await renderTab({trainingMods: [], proposalRetentionDays: 14,},)
		const number = container.querySelector<HTMLInputElement>('input[type="number"]',)!
		await act(async () => {
			setInputValue(number, '9999',)
		},)
		await act(async () => {
			saveRef.current?.()
		},)
		const saved = onSave.mock.calls[0]![0] as {proposalRetentionDays: number}
		expect(saved.proposalRetentionDays,).toBe(365,)
	})

	it('locks the current user and more-senior mods, leaving juniors editable', async () => {
		// Seniority-ordered listing: TopMod (senior), Me, Junior. The current user is "Me".
		getSubredditListing.mockResolvedValue({
			data: {
				children: [
					{name: 'TopMod', mod_permissions: [],},
					{name: 'Me', mod_permissions: [],},
					{name: 'Junior', mod_permissions: [],},
				],
			},
		},)
		getCurrentUser.mockResolvedValue('me',)

		await renderTab({trainingMods: [],},)

		const modCheckbox = (name: string,) =>
			[...container.querySelectorAll<HTMLLabelElement>('label',),]
				.find((l,) => l.textContent?.includes(`u/${name}`,))!
				.querySelector<HTMLInputElement>('input[type="checkbox"]',)!

		// Self and the more-senior mod are locked; only the junior can be changed.
		expect(modCheckbox('TopMod',).disabled,).toBe(true,)
		expect(modCheckbox('Me',).disabled,).toBe(true,)
		expect(modCheckbox('Junior',).disabled,).toBe(false,)
	})

	it('shows a 6.x compatibility warning when compat writes are on', async () => {
		resolveWikiLayout.mockResolvedValue({state: 'nxg', compatibilityWrites: true,},)
		await renderTab({trainingMods: [],},)
		expect(container.textContent,).toContain('Toolbox 6.x compatibility',)
	})
})
