/** Tests for getRemovalReasons, focused on the getfrom redirect and its mod-gate opt-in. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getConfig = vi.hoisted(() => vi.fn())

vi.mock('../config/moduleapi', () => ({getConfig, saveToolboxConfig: vi.fn(),}),)

import {getRemovalReasons,} from './moduleapi'

beforeEach(() => {
	vi.clearAllMocks()
},)

describe('getRemovalReasons', () => {
	it('reads the acting sub with the default mod-gate (no opt-in)', async () => {
		getConfig.mockResolvedValue({removalReasons: {reasons: [{text: 'spam',},],},},)

		const result = await getRemovalReasons('mysub',)

		expect(getConfig,).toHaveBeenCalledWith('mysub', {allowNonModerated: false,},)
		expect(result,).toEqual({reasons: [{text: 'spam',},],},)
	})

	it('returns false when the acting sub has no removal reasons configured', async () => {
		getConfig.mockResolvedValue({},)

		expect(await getRemovalReasons('mysub',),).toBe(false,)
	})

	it('follows a getfrom redirect, reading the source sub with the mod-gate opted out', async () => {
		// Shared removal reasons: a sub the viewer moderates points its reasons at a different
		// sub they may not moderate. The acting read stays gated; the source read opts out so
		// the cross-sub share still resolves.
		getConfig.mockImplementation(async (sub: string,) =>
			sub === 'mysub'
				? {removalReasons: {getfrom: 'sharedsub', reasons: [],},}
				: {removalReasons: {reasons: [{text: 'from shared',},],},}
		)

		const result = await getRemovalReasons('mysub',)

		expect(getConfig,).toHaveBeenCalledWith('mysub', {allowNonModerated: false,},)
		expect(getConfig,).toHaveBeenCalledWith('sharedsub', {allowNonModerated: true,},)
		expect(result,).toEqual({reasons: [{text: 'from shared',},],},)
	})

	it('does not follow a self-referential getfrom', async () => {
		getConfig.mockResolvedValue({removalReasons: {getfrom: 'mysub', reasons: [{text: 'self',},],},},)

		const result = await getRemovalReasons('mysub',)

		expect(getConfig,).toHaveBeenCalledTimes(1,)
		expect(result,).toEqual({getfrom: 'mysub', reasons: [{text: 'self',},],},)
	})
})
