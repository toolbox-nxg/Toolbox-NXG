/** Tests for config reconciliation between the NXG page and the legacy 6.x mirror. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readFromWiki = vi.hoisted(() => vi.fn())

vi.mock('../../../../api/resources/wiki', () => ({
	readFromWiki,
	postToWiki: vi.fn(),
	readWikiRevision: vi.fn(),
}),)
vi.mock('../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../../data/purify', () => ({purify: (s: string,) => s, purifyObject: vi.fn(),}),)
vi.mock('../../../infra/logging', () => ({
	default: () => ({debug: vi.fn(), warn: vi.fn(), error: vi.fn(),}),
}),)
vi.mock('../../util/persistence/cache', () => ({
	clearCache: vi.fn(),
	getCache: vi.fn().mockImplementation((_moduleId: unknown, _key: unknown, defaultVal: unknown,) =>
		Promise.resolve(defaultVal,)
	),
	setCache: vi.fn(),
}),)
vi.mock('../../store/feedback', () => ({
	negativeTextFeedback: vi.fn(),
	neutralTextFeedback: vi.fn(),
	positiveTextFeedback: vi.fn(),
}),)
import {adoptLegacyConfigFields, legacyOwnedFieldsEqual, reconcileConfigFromLegacy,} from './reconcile'
import {normalizeConfig,} from './schema'
import type {ToolboxConfig,} from './schema'

/** Builds a normalized v2 config from a partial shape. */
function makeConfig (partial: Record<string, any> = {},): ToolboxConfig {
	const config: Record<string, any> = {ver: 2, ...partial,}
	normalizeConfig(config,)
	return config as ToolboxConfig
}

beforeEach(() => {
	vi.clearAllMocks()
},)

describe('legacyOwnedFieldsEqual', () => {
	it('ignores ids and object key order', () => {
		const nxg = makeConfig({
			removalReasons: {reasons: [{id: 'aaaaaaaa', title: 'Spam', text: 'no spam',},],},
		},)
		const legacy = makeConfig({
			removalReasons: {reasons: [{text: 'no spam', title: 'Spam',},],},
		},)
		// normalizeConfig assigned the legacy entry a different random id.
		expect(nxg.removalReasons.reasons[0]!.id,).not.toBe(legacy.removalReasons.reasons[0]!.id,)

		expect(legacyOwnedFieldsEqual(nxg, legacy,),).toBe(true,)
	})

	it('detects differences in any 6.x-owned field', () => {
		// banMacros differs: one has a value, the other is null.
		const nxg = makeConfig({banMacros: {note: 'test', message: 'hi', duration: 1, reason: '',},},)
		const legacy = makeConfig({banMacros: null,},)

		expect(legacyOwnedFieldsEqual(nxg, legacy,),).toBe(false,)
	})

	it('treats coerced banMacros (null) as equal across representations', () => {
		// normalizeConfig coerces '' and missing to null on both sides.
		const nxg = makeConfig({banMacros: '',},)
		const legacy = makeConfig({},)

		expect(legacyOwnedFieldsEqual(nxg, legacy,),).toBe(true,)
	})

	it('ignores the NXG-only suggestedReasons block (absent from the legacy mirror)', () => {
		const nxg = makeConfig({
			removalReasons: {
				reasons: [{id: 'reason01', title: 'Spam', text: 'no spam',},],
				suggestedReasons: [{id: 'sug00001', pattern: 'meta post', reasonIds: ['reason01',],},],
			},
		},)
		const legacy = makeConfig({
			removalReasons: {reasons: [{title: 'Spam', text: 'no spam',},],},
		},)

		// The reasons match; suggestedReasons must not register as a difference.
		expect(legacyOwnedFieldsEqual(nxg, legacy,),).toBe(true,)
	})
})

describe('adoptLegacyConfigFields', () => {
	it('preserves NXG ids for content-matched entries and mints fresh ids for new ones', () => {
		const nxg = makeConfig({
			removalReasons: {
				reasons: [
					{id: 'reason01', title: 'Spam', text: 'no spam',},
					{id: 'reason02', title: 'Rude', text: 'be nice',},
				],
			},
			modMacros: [{id: 'macro001', title: 'Hi', text: 'hello',},],
		},)
		const legacy = makeConfig({
			removalReasons: {
				reasons: [
					// Reordered + one new entry; 'Rude' was deleted in 6.x... but
					// adoption keeps exactly what the legacy page says.
					{title: 'New rule', text: 'added in 6.x',},
					{title: 'Spam', text: 'no spam',},
				],
			},
			modMacros: [{title: 'Hi', text: 'hello',},],
		},)

		const adopted = adoptLegacyConfigFields(nxg, legacy,)

		const reasons = adopted.removalReasons.reasons
		expect(reasons.map((r,) => r.title),).toEqual(['New rule', 'Spam',],)
		expect(reasons[1]!.id,).toBe('reason01',)
		expect(reasons[0]!.id,).toMatch(/^[a-z0-9]{8}$/,)
		expect(reasons[0]!.id,).not.toBe('reason02',)
		expect(adopted.modMacros[0]!.id,).toBe('macro001',)
	})

	it('carries the NXG-only suggestedReasons over when adopting 6.x reason edits', () => {
		const nxg = makeConfig({
			removalReasons: {
				reasons: [{id: 'reason01', title: 'Spam', text: 'no spam',},],
				suggestedReasons: [{id: 'sug00001', pattern: 'meta post', reasonIds: ['reason01',],},],
			},
		},)
		// 6.x edited a reason on the legacy mirror (which never carries suggestedReasons).
		const legacy = makeConfig({
			removalReasons: {reasons: [{title: 'Spam', text: 'no spam at all',},],},
		},)

		const adopted = adoptLegacyConfigFields(nxg, legacy,)

		expect(adopted.removalReasons.reasons[0]!.text,).toBe('no spam at all',)
		expect(adopted.removalReasons.suggestedReasons,).toEqual([
			{id: 'sug00001', pattern: 'meta post', reasonIds: ['reason01',],},
		],)
	})

	it('does not reuse one NXG id for duplicated legacy content', () => {
		const nxg = makeConfig({
			removalReasons: {reasons: [{id: 'reason01', title: 'Spam', text: 'no spam',},],},
		},)
		const legacy = makeConfig({
			removalReasons: {
				reasons: [
					{title: 'Spam', text: 'no spam',},
					{title: 'Spam', text: 'no spam',},
				],
			},
		},)

		const adopted = adoptLegacyConfigFields(nxg, legacy,)

		const ids = adopted.removalReasons.reasons.map((r,) => r.id)
		expect(ids[0],).toBe('reason01',)
		expect(ids[1],).not.toBe('reason01',)
		expect(new Set(ids,).size,).toBe(2,)
	})

	it('keeps NXG-only keys and does not mutate its inputs', () => {
		const nxg = makeConfig({'Toolbox.Utils.compatibilityWrites': true,},)
		// banMacros is a legacy-owned field; verify it is adopted from the legacy page.
		const legacy = makeConfig({banMacros: {banNote: 'test', banMessage: 'hi',},},)
		const nxgSnapshot = structuredClone(nxg,)

		const adopted = adoptLegacyConfigFields(nxg, legacy,)

		expect((adopted as Record<string, any>)['Toolbox.Utils.compatibilityWrites'],).toBe(true,)
		expect(adopted.ver,).toBe(2,)
		expect(adopted.banMacros,).toEqual(legacy.banMacros,)
		expect(nxg,).toEqual(nxgSnapshot,)
	})
})

describe('reconcileConfigFromLegacy', () => {
	it('is a no-op when the legacy page is missing or tombstoned', async () => {
		const nxg = makeConfig()

		readFromWiki.mockResolvedValue({ok: false, reason: 'no_page',},)
		expect(await reconcileConfigFromLegacy('sub', nxg,),).toEqual({config: nxg, changed: false,},)

		readFromWiki.mockResolvedValue({ok: true, data: {'Toolbox.Utils.wikiLayout': 'nxg',},},)
		expect(await reconcileConfigFromLegacy('sub', nxg,),).toEqual({config: nxg, changed: false,},)
	})

	it('is a no-op when the read fails', async () => {
		const nxg = makeConfig()
		readFromWiki.mockRejectedValue(new Error('network',),)

		expect(await reconcileConfigFromLegacy('sub', nxg,),).toEqual({config: nxg, changed: false,},)
	})

	it('normalizes a v1 legacy page before comparing (no false positives)', async () => {
		// The mirror stores escape()-encoded v1 text; after normalization it
		// matches the NXG plain text, so nothing is adopted.
		const nxg = makeConfig({
			removalReasons: {reasons: [{id: 'reason01', title: 'Spam', text: 'no spam please',},],},
		},)
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {ver: 1, removalReasons: {reasons: [{title: 'Spam', text: 'no%20spam%20please',},],},},
		},)

		const result = await reconcileConfigFromLegacy('sub', nxg,)

		expect(result.changed,).toBe(false,)
		expect(result.config,).toBe(nxg,)
	})

	it('treats NXG select definitions and the equivalent mirror HTML as equal (no false positives)', async () => {
		// The mirror carries the expanded <select> HTML; normalization extracts
		// it back into the same definitions, so nothing is adopted. The prompt
		// must round-trip as absent-or-non-empty and generated names must be
		// deterministic, or this comparison would diverge forever.
		const nxg = makeConfig({
			removalReasons: {
				reasons: [{
					id: 'reason01',
					title: 'Rules',
					text: 'Pick {select:rule} and {select:select-1}',
					selects: [
						{name: 'rule', prompt: 'Which rule?', options: ['Rule 1', 'Rule 2',],},
						{name: 'select-1', options: ['a', 'b',],},
					],
				},],
			},
		},)
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {
				ver: 1,
				removalReasons: {
					reasons: [{
						title: 'Rules',
						// eslint-disable-next-line no-restricted-globals
						text: escape(
							'Pick <select id="rule" label="Which rule?"><option>Rule 1</option><option>Rule 2</option>'
								+ '</select> and <select><option>a</option><option>b</option></select>',
						),
					},],
				},
			},
		},)

		const result = await reconcileConfigFromLegacy('sub', nxg,)

		expect(result.changed,).toBe(false,)
		expect(result.config,).toBe(nxg,)
	})

	it('adopts a 6.x edit to a select option', async () => {
		const nxg = makeConfig({
			removalReasons: {
				reasons: [{
					id: 'reason01',
					title: 'Rules',
					text: 'Pick {select:rule}',
					selects: [{name: 'rule', options: ['Rule 1', 'Rule 2',],},],
				},],
			},
		},)
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {
				ver: 1,
				removalReasons: {
					reasons: [{
						title: 'Rules',
						// eslint-disable-next-line no-restricted-globals
						text: escape(
							'Pick <select id="rule"><option>Rule 1 (edited)</option><option>Rule 2</option></select>',
						),
					},],
				},
			},
		},)

		const result = await reconcileConfigFromLegacy('sub', nxg,)

		expect(result.changed,).toBe(true,)
		expect(result.config.removalReasons.reasons[0]!.selects,).toEqual([
			{name: 'rule', options: ['Rule 1 (edited)', 'Rule 2',],},
		],)
		expect(result.config.removalReasons.reasons[0]!.text,).toBe('Pick {select:rule}',)
	})

	it('adopts 6.x edits when the mirror diverges', async () => {
		const nxg = makeConfig({
			removalReasons: {reasons: [{id: 'reason01', title: 'Spam', text: 'no spam',},],},
		},)
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {
				ver: 1,
				removalReasons: {
					reasons: [
						{title: 'Spam', text: 'no spam',},
						{title: 'Added', text: 'from 6.x',},
					],
				},
			},
		},)

		const result = await reconcileConfigFromLegacy('sub', nxg,)

		expect(result.changed,).toBe(true,)
		expect(result.config.removalReasons.reasons.map((r,) => r.title),).toEqual(['Spam', 'Added',],)
		expect(result.config.removalReasons.reasons[0]!.id,).toBe('reason01',)
	})
})
