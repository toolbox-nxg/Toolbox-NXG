/** Tests for relationships API. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())

vi.mock('../transport/http', () => ({apiOauthGetJSON, apiOauthPOST,}),)

import {CaptureSuppressedError, setCaptureActivePredicate,} from '../../util/infra/captureGuard'
import {
	addContributor,
	addModerator,
	banUser,
	getBanState,
	getContributorState,
	getModeratorListResult,
	getMuteState,
	removeContributor,
	removeModerator,
	unbanUser,
} from './relationships'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	apiOauthGetJSON.mockReset()
	apiOauthPOST.mockReset().mockImplementation(() => Promise.resolve(jsonResponse({json: {errors: [],},},),))
},)

afterEach(() => {
	setCaptureActivePredicate(() => false)
},)

describe('relationships API', () => {
	it('returns matching ban state case-insensitively', async () => {
		apiOauthGetJSON.mockResolvedValue({data: {children: [{name: 'Other',}, {name: 'Alice', id: 't2_a',},],},},)

		await expect(getBanState('testsub', 'alice',),).resolves.toEqual({name: 'Alice', id: 't2_a',},)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/r/testsub/about/banned/.json', {user: 'alice',},)
	})

	it('returns contributor and mute states case-insensitively', async () => {
		apiOauthGetJSON
			.mockResolvedValueOnce({data: {children: [{name: 'Alice',},],},},)
			.mockResolvedValueOnce({data: {children: [{name: 'Bob',},],},},)

		await expect(getContributorState('testsub', 'alice',),).resolves.toEqual({name: 'Alice',},)
		await expect(getMuteState('testsub', 'bob',),).resolves.toEqual({name: 'Bob',},)
	})

	it('summarizes moderator list results for target and current users', async () => {
		apiOauthGetJSON.mockResolvedValue({
			data: {
				children: [
					{name: 'Alice', mod_permissions: ['posts',],},
					{name: 'CurrentMod', mod_permissions: ['all',],},
				],
			},
		},)

		await expect(getModeratorListResult('testsub', 'alice', 'currentmod',),).resolves.toEqual({
			targetIsMod: true,
			currentUserPermissions: ['all',],
		},)
	})

	it('posts unfriend/friend calls for unban, contributor, and moderator actions', async () => {
		await expect(unbanUser('testsub', 'alice',),).resolves.toBeUndefined()
		await expect(addContributor('testsub', 'alice',),).resolves.toBeUndefined()
		await expect(removeContributor('testsub', 'alice',),).resolves.toBeUndefined()
		await expect(addModerator('testsub', 'alice',),).resolves.toBeUndefined()
		await expect(removeModerator('testsub', 'alice',),).resolves.toBeUndefined()

		expect(apiOauthPOST.mock.calls,).toEqual([
			['/api/unfriend', expect.objectContaining({type: 'banned', name: 'alice', r: 'testsub',},),],
			['/api/friend', expect.objectContaining({type: 'contributor', name: 'alice', r: 'testsub',},),],
			['/api/unfriend', expect.objectContaining({type: 'contributor', name: 'alice', r: 'testsub',},),],
			['/api/friend', expect.objectContaining({type: 'moderator', name: 'alice', r: 'testsub',},),],
			['/api/unfriend', expect.objectContaining({type: 'moderator', name: 'alice', r: 'testsub',},),],
		],)
	})

	it('blocks contributor and moderator changes for a sandboxed trainee without performing them', () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')

		expect(() => addContributor('sandboxed', 'alice',)).toThrow(CaptureSuppressedError,)
		expect(() => removeContributor('sandboxed', 'alice',)).toThrow(CaptureSuppressedError,)
		expect(() => addModerator('sandboxed', 'alice',)).toThrow(CaptureSuppressedError,)
		expect(() => removeModerator('sandboxed', 'alice',)).toThrow(CaptureSuppressedError,)
		expect(apiOauthPOST,).not.toHaveBeenCalled()
	})

	it('clamps and truncates ban payload fields', async () => {
		await expect(banUser({
			user: 'alice',
			subreddit: 'testsub',
			note: 'n'.repeat(305,),
			banMessage: 'm'.repeat(1005,),
			banDuration: 5000,
			banContext: 't3_post',
		},),).resolves.toBeUndefined()

		expect(apiOauthPOST,).toHaveBeenCalledWith(
			'/api/friend',
			expect.objectContaining({
				type: 'banned',
				name: 'alice',
				r: 'testsub',
				note: 'n'.repeat(300,),
				ban_message: 'm'.repeat(999,),
				duration: '999',
				ban_context: 't3_post',
			},),
		)
	})
})
