/** Tests for the pure ModButtonPopup helpers. */

import {describe, expect, it, vi,} from 'vitest'

// The helpers module transitively imports API modules that load the polyfill,
// which throws when imported outside a real extension context.
vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)
import {SubStatus,} from '../schema'
import {hasPermission, isActionApplicable, notApplicableReason,} from './ModButtonPopup.helpers'

function status (overrides: Partial<SubStatus> = {},): SubStatus {
	return {
		loading: false,
		banned: false,
		daysLeft: null,
		isMod: false,
		isContributor: false,
		isMuted: false,
		currentUserPermissions: [],
		...overrides,
	}
}

describe('hasPermission', () => {
	it('grants everything for the all permission', () => {
		expect(hasPermission(['all',], 'access',),).toBe(true,)
	})

	it('matches any of the required permissions', () => {
		expect(hasPermission(['mail', 'flair',], 'access', 'mail',),).toBe(true,)
	})

	it('rejects when nothing matches', () => {
		expect(hasPermission(['flair',], 'access',),).toBe(false,)
	})
})

describe('isActionApplicable', () => {
	it('treats unknown or loading status as applicable', () => {
		expect(isActionApplicable(undefined, 'ban',),).toBe(true,)
		expect(isActionApplicable(status({loading: true, isMod: true,},), 'ban',),).toBe(true,)
	})

	it('blocks ban, change ban, mute, and mod for mods', () => {
		const modStatus = status({isMod: true,},)
		expect(isActionApplicable(modStatus, 'ban',),).toBe(false,)
		expect(isActionApplicable(modStatus, 'change ban',),).toBe(false,)
		expect(isActionApplicable(modStatus, 'mute',),).toBe(false,)
		expect(isActionApplicable(modStatus, 'mod',),).toBe(false,)
		expect(isActionApplicable(modStatus, 'demod',),).toBe(true,)
	})

	it('gates mute/unmute on current mute state', () => {
		expect(isActionApplicable(status(), 'unmute',),).toBe(false,)
		expect(isActionApplicable(status({isMuted: true,},), 'unmute',),).toBe(true,)
	})

	it('gates contributor actions on current contributor state', () => {
		expect(isActionApplicable(status(), 'add submitter',),).toBe(true,)
		expect(isActionApplicable(status(), 'remove submitter',),).toBe(false,)
		expect(isActionApplicable(status({isContributor: true,},), 'add submitter',),).toBe(false,)
		expect(isActionApplicable(status({isContributor: true,},), 'remove submitter',),).toBe(true,)
	})
})

describe('notApplicableReason', () => {
	it('returns a reason for every action kind', () => {
		const kinds = [
			'ban',
			'change ban',
			'add submitter',
			'remove submitter',
			'mod',
			'demod',
			'mute',
			'unmute',
		] as const
		for (const kind of kinds) {
			expect(notApplicableReason(kind,),).toBeTruthy()
		}
	})
})
