/** Tests for config reconciliation between the NXG page and the legacy 6.x mirror. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readFromWiki = vi.hoisted(() => vi.fn())
const getWikiRevisions = vi.hoisted(() => vi.fn())

vi.mock('../../../../api/resources/wiki', () => ({
	readFromWiki,
	getWikiRevisions,
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
import {mergeNativeReasons,} from '../../../../modules/removalreasons/nativeSync'
import {encodeClassicConfig,} from './codec'
import {
	adoptLegacyConfigFields,
	legacyOwnedFieldsEqual,
	mirrorViewOfConfig,
	reconcileConfigFromLegacy,
} from './reconcile'
import {normalizeConfig,} from './schema'
import type {ToolboxConfig,} from './schema'

/** Builds a normalized v2 config from a partial shape. */
function makeConfig (partial: Record<string, unknown> = {},): ToolboxConfig {
	const config: Record<string, unknown> = {ver: 2, ...partial,}
	normalizeConfig(config,)
	return config as ToolboxConfig
}

/** A revision listing whose newest entry carries the given unix timestamp. */
function revisionsAt (timestamp: number,) {
	return [{id: `rev-${timestamp}`, timestamp, author: 'sixmod', reason: '',},]
}

/** Arbitration options standing in for a canonical page last written at t=1000. */
const canonicalAt1000 = {nxgRevisionTimestamp: 1000,}

beforeEach(() => {
	vi.clearAllMocks()
	// Default: the mirror is newer than the canonical page, so tests that assert
	// adoption exercise the adopt branch without restating the arbitration.
	getWikiRevisions.mockResolvedValue(revisionsAt(2000,),)
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

		expect((adopted as Record<string, unknown>)['Toolbox.Utils.compatibilityWrites'],).toBe(true,)
		expect(adopted.ver,).toBe(2,)
		expect(adopted.banMacros,).toEqual(legacy.banMacros,)
		expect(nxg,).toEqual(nxgSnapshot,)
	})
})

describe('reconcileConfigFromLegacy', () => {
	it('is a no-op when the legacy page is missing or tombstoned', async () => {
		const nxg = makeConfig()

		readFromWiki.mockResolvedValue({ok: false, reason: 'no_page',},)
		expect(await reconcileConfigFromLegacy('sub', nxg,),)
			.toEqual({config: nxg, changed: false, outcome: 'equal',},)

		readFromWiki.mockResolvedValue({ok: true, data: {'Toolbox.Utils.wikiLayout': 'nxg',},},)
		expect(await reconcileConfigFromLegacy('sub', nxg,),)
			.toEqual({config: nxg, changed: false, outcome: 'equal',},)
	})

	it('is a no-op when the read fails', async () => {
		const nxg = makeConfig()
		readFromWiki.mockRejectedValue(new Error('network',),)

		expect(await reconcileConfigFromLegacy('sub', nxg,),)
			.toEqual({config: nxg, changed: false, outcome: 'equal',},)
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

	it('treats an NXG {choice} block and the equivalent mirror <select> as equal (no false positives)', async () => {
		// The mirror carries the expanded <select> HTML; normalization rewrites it
		// back into the same inline {choice} block (the prompt is plain text above
		// the marker), so the two normalize to the same string and nothing is
		// adopted.
		const nxg = makeConfig({
			removalReasons: {
				reasons: [{
					id: 'reason01',
					title: 'Rules',
					text: 'Which rule?\n\n{choice#rule}\n- Rule 1\n- Rule 2',
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

						text: escape(
							'Which rule?\n\n<select id="rule"><option>Rule 1</option><option>Rule 2</option></select>',
						),
					},],
				},
			},
		},)

		const result = await reconcileConfigFromLegacy('sub', nxg,)

		expect(result.changed,).toBe(false,)
		expect(result.config,).toBe(nxg,)
	})

	it('adopts a 6.x edit to a choice option', async () => {
		const nxg = makeConfig({
			removalReasons: {
				reasons: [{
					id: 'reason01',
					title: 'Rules',
					text: '{choice#rule}\n- Rule 1\n- Rule 2',
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

						text: escape(
							'<select id="rule"><option>Rule 1 (edited)</option><option>Rule 2</option></select>',
						),
					},],
				},
			},
		},)

		const result = await reconcileConfigFromLegacy('sub', nxg, canonicalAt1000,)

		expect(result.changed,).toBe(true,)
		expect(result.config.removalReasons.reasons[0]!.text,).toBe('{choice#rule}\n- Rule 1 (edited)\n- Rule 2',)
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

		const result = await reconcileConfigFromLegacy('sub', nxg, canonicalAt1000,)

		expect(result.changed,).toBe(true,)
		expect(result.config.removalReasons.reasons.map((r,) => r.title),).toEqual(['Spam', 'Added',],)
		expect(result.config.removalReasons.reasons[0]!.id,).toBe('reason01',)
	})
})

describe('reconcile revision arbitration', () => {
	/** An NXG config and a diverged mirror carrying an extra 6.x-added reason. */
	function divergedPair () {
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
		return nxg
	}

	it('adopts when the mirror was written after the canonical page', async () => {
		const nxg = divergedPair()
		getWikiRevisions.mockResolvedValue(revisionsAt(2000,),)

		const result = await reconcileConfigFromLegacy('sub', nxg, {nxgRevisionTimestamp: 1000,},)

		expect(result.outcome,).toBe('adopted',)
		expect(result.changed,).toBe(true,)
		expect(result.config.removalReasons.reasons.map((r,) => r.title),).toEqual(['Spam', 'Added',],)
	})

	it('keeps the canonical config when the mirror is older', async () => {
		// The regression test for the reported bug: an NXG edit whose mirror write did not
		// land must not be reverted by the stale mirror on the next read.
		const nxg = divergedPair()
		getWikiRevisions.mockResolvedValue(revisionsAt(1000,),)

		const result = await reconcileConfigFromLegacy('sub', nxg, {nxgRevisionTimestamp: 2000,},)

		expect(result.outcome,).toBe('keptCanonical',)
		expect(result.changed,).toBe(false,)
		expect(result.config,).toBe(nxg,)
	})

	it('keeps the canonical config when the two revisions share a timestamp', async () => {
		const nxg = divergedPair()
		getWikiRevisions.mockResolvedValue(revisionsAt(1000,),)

		const result = await reconcileConfigFromLegacy('sub', nxg, {nxgRevisionTimestamp: 1000,},)

		expect(result.outcome,).toBe('keptCanonical',)
		expect(result.config,).toBe(nxg,)
	})

	it('keeps the canonical config when the canonical revision is unknown', async () => {
		const nxg = divergedPair()
		getWikiRevisions.mockResolvedValue(revisionsAt(2000,),)

		const result = await reconcileConfigFromLegacy('sub', nxg,)

		expect(result.outcome,).toBe('unarbitrable',)
		expect(result.config,).toBe(nxg,)
	})

	it('keeps the canonical config when the mirror revisions cannot be read', async () => {
		const nxg = divergedPair()
		getWikiRevisions.mockRejectedValue(new Error('network',),)

		const result = await reconcileConfigFromLegacy('sub', nxg, {nxgRevisionTimestamp: 1000,},)

		expect(result.outcome,).toBe('unarbitrable',)
		expect(result.config,).toBe(nxg,)
	})

	it('keeps the canonical config when the mirror revision listing is empty', async () => {
		const nxg = divergedPair()
		getWikiRevisions.mockResolvedValue([],)

		const result = await reconcileConfigFromLegacy('sub', nxg, {nxgRevisionTimestamp: 1000,},)

		expect(result.outcome,).toBe('unarbitrable',)
		expect(result.config,).toBe(nxg,)
	})

	it('does not date the mirror at all when the contents agree', async () => {
		const nxg = makeConfig({
			removalReasons: {reasons: [{id: 'reason01', title: 'Spam', text: 'no spam',},],},
		},)
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {ver: 1, removalReasons: {reasons: [{title: 'Spam', text: 'no spam',},],},},
		},)

		const result = await reconcileConfigFromLegacy('sub', nxg, {nxgRevisionTimestamp: 1000,},)

		expect(result.outcome,).toBe('equal',)
		expect(getWikiRevisions,).not.toHaveBeenCalled()
	})
})

describe('native reason sync across the legacy mirror', () => {
	/** A config holding one hand-written reason and two reasons synced from Reddit. */
	function nxgWithSyncedReasons () {
		return makeConfig({
			removalReasons: {
				reasons: [
					{id: 'reason01', title: 'Spam', text: 'no spam',},
					{id: 'reason02', title: 'Rule 1', text: 'from reddit 1', nativeReasonId: 'native-1',},
					{id: 'reason03', title: 'Rule 2', text: 'from reddit 2', nativeReasonId: 'native-2',},
				],
				nativeSync: {enabled: true, fingerprint: 'deadbeefdeadbeef', lastSyncedAt: 1700000000000,},
			},
		},)
	}

	it('treats an untouched mirror as equal, so a read never clobbers synced reasons', () => {
		// The regression test for the clobber-on-every-read hazard: the mirror is a
		// deterministic down-convert that omits synced reasons entirely, so comparing it
		// against the full NXG list must not register as a 6.x edit.
		const nxg = nxgWithSyncedReasons()
		const mirror = encodeClassicConfig(nxg,) as unknown as Record<string, unknown>
		normalizeConfig(mirror,)

		expect(legacyOwnedFieldsEqual(nxg, mirror as unknown as ToolboxConfig,),).toBe(true,)
	})

	it('still detects a real 6.x edit alongside synced reasons', () => {
		const nxg = nxgWithSyncedReasons()
		const mirror = encodeClassicConfig(nxg,) as unknown as Record<string, unknown>
		normalizeConfig(mirror,)
		;(mirror as unknown as ToolboxConfig).removalReasons.reasons[0]!.text = 'edited in 6.x'

		expect(legacyOwnedFieldsEqual(nxg, mirror as unknown as ToolboxConfig,),).toBe(false,)
	})

	it('carries synced reasons and nativeSync back when adopting a 6.x edit', () => {
		const nxg = nxgWithSyncedReasons()
		const legacy = makeConfig({
			removalReasons: {reasons: [{title: 'Spam', text: 'edited in 6.x',},],},
		},)

		const adopted = adoptLegacyConfigFields(nxg, legacy,)

		expect(adopted.removalReasons.reasons.map((r,) => r.title),).toEqual(['Spam', 'Rule 1', 'Rule 2',],)
		expect(adopted.removalReasons.reasons[0]!.text,).toBe('edited in 6.x',)
		expect(adopted.removalReasons.reasons[1]!.nativeReasonId,).toBe('native-1',)
		expect(adopted.removalReasons.reasons[2]!.nativeReasonId,).toBe('native-2',)
		expect(adopted.removalReasons.nativeSync?.fingerprint,).toBe('deadbeefdeadbeef',)
	})

	it('does not let an adopted reason claim a synced reason\'s stable id', () => {
		// A moderator who copies a synced reason's title and text into a hand-written one (or a
		// 6.x save made before the sync converted it) leaves the mirror holding an entry that
		// content-matches a synced reason. The synced reason is re-appended with its own id, so
		// handing that id to the adopted entry would put it on two reasons at once and break
		// every lookup keyed on it.
		const nxg = nxgWithSyncedReasons()
		const legacy = makeConfig({
			removalReasons: {reasons: [{title: 'Rule 1', text: 'from reddit 1',},],},
		},)

		const adopted = adoptLegacyConfigFields(nxg, legacy,)

		const ids = adopted.removalReasons.reasons.map((r,) => r.id)
		expect(new Set(ids,).size,).toBe(ids.length,)
		// The synced reason kept the id it is re-appended with; the adopted copy got a fresh one.
		expect(adopted.removalReasons.reasons.find((r,) => r.nativeReasonId === 'native-1')?.id,)
			.toBe('reason02',)
		expect(adopted.removalReasons.reasons[0]!.id,).not.toBe('reason02',)
	})

	it('survives a full 6.x round trip without orphaning or duplicating a synced reason', () => {
		const nxg = nxgWithSyncedReasons()
		const nativeReasons = [
			{id: 'native-1', title: 'Rule 1', message: 'from reddit 1',},
			{id: 'native-2', title: 'Rule 2', message: 'from reddit 2',},
		]

		// Down-convert to the mirror: only the hand-written reason survives.
		const mirror = encodeClassicConfig(nxg,) as unknown as Record<string, unknown>
		expect((mirror as unknown as ToolboxConfig).removalReasons.reasons,).toHaveLength(1,)
		// Simulate a 6.x save: it edits a reason and rebuilds entries without stable ids.
		normalizeConfig(mirror,)
		const saved = mirror as unknown as ToolboxConfig
		saved.removalReasons.reasons = [{
			title: 'Spam',
			text: 'edited in 6.x',
			flairText: '',
			flairCSS: '',
			flairTemplateID: '',
		},]

		readFromWiki.mockResolvedValue({ok: true, data: saved,},)
		return reconcileConfigFromLegacy('sub', nxg, canonicalAt1000,).then((result,) => {
			expect(result.changed,).toBe(true,)
			const reasons = result.config.removalReasons.reasons
			// The 6.x edit was adopted. Its stable id is not preserved, because
			// preserveIdsByContent matches on title+text and 6.x changed the text - that is
			// pre-existing behavior for any 6.x-edited reason, not specific to the sync.
			expect(reasons[0]!.text,).toBe('edited in 6.x',)
			// Both sync links survived with their stable ids, and nothing was duplicated.
			expect(reasons.filter((r,) => r.nativeReasonId).map((r,) => r.nativeReasonId),)
				.toEqual(['native-1', 'native-2',],)
			expect(reasons.filter((r,) => r.nativeReasonId).map((r,) => r.id),)
				.toEqual(['reason02', 'reason03',],)
			expect(reasons,).toHaveLength(3,)
			expect(result.config.removalReasons.nativeSync?.enabled,).toBe(true,)
			// The clincher: a sync against the unchanged native set now has nothing to do.
			expect(mergeNativeReasons(reasons, nativeReasons,).changed,).toBe(false,)
		},)
	})
})

/**
 * Configs whose legacy mirror must reconcile as a no-op. Each entry is the
 * partial config under test; the mirror is produced by the real down-convert, so
 * a reconcile that reports anything but `equal` means an untouched mirror would
 * be mistaken for a 6.x edit and clobber the canonical page on every read.
 */
const fixedPointCases: Array<[string, Record<string, unknown>,]> = [
	['plain ascii', {
		removalReasons: {reasons: [{title: 'Spam', text: 'Please do not spam.',},],},
	},],
	['non-ascii and emoji', {
		removalReasons: {
			header: 'Gruesse aus /r/{subreddit} - Regel N‖1',
			reasons: [{title: 'Règle №1', text: 'Grüße 🚫 - entfernt.',},],
		},
		modMacros: [{title: 'Hallo', text: 'Schönen Tag 🙂',},],
	},],
	['literal percent signs', {
		removalReasons: {
			logtitle: 'Removal: 50% off {title}',
			reasons: [{title: '100% spam', text: 'This was 100% removed.',},],
		},
	},],
	['percent-encoded-looking sequences in fields the mirror never escapes', {
		removalReasons: {
			logtitle: 'Removed %E2%9C%93',
			pmsubject: 'Re: a%20b',
			reasons: [{title: 'Rule a%2Fb', text: 'see the wiki', flairText: 'a%2Fb', flairCSS: 'x%20y',},],
		},
		banMacros: {note: 'n%2Fa', message: 'https://example.com/?q=a%20b', duration: 3, reason: 'r%20s',},
	},],
	['choice blocks with and without an id', {
		removalReasons: {
			reasons: [
				{title: 'Rules', text: 'Which rule?\n\n{choice#rule}\n- Rule 1\n- Rule 2\n\nThanks.',},
				{title: 'Other', text: 'Pick one:\n\n{choice}\n- A\n- B',},
			],
		},
	},],
	['inline input and textarea tokens', {
		removalReasons: {
			reasons: [{title: 'Detail', text: 'Reason: {input: short reason}\n\nNotes: {textarea: anything else}',},],
		},
	},],
	['a choice block in the header and footer', {
		// Headers and footers render no interactive controls, so the up-convert leaves
		// their <select> literal while the down-convert still expands the block. Only
		// the mirror-view comparison can see through that asymmetry.
		removalReasons: {
			header: 'Before:\n\n{choice#hdr}\n- one\n- two',
			footer: 'After:\n\n{choice}\n- three',
			reasons: [{title: 'Spam', text: 'no spam',},],
		},
	},],
	['multi-line header and footer markdown', {
		removalReasons: {
			header: '# Notice\n\nYour post was removed because:\n\n- reason one\n- reason two\n\n---\n',
			footer: '\n---\n\n^(Replies to this comment are not monitored.)\n\n[Message us](/message/compose)',
			reasons: [{title: 'Spam', text: 'no spam',},],
		},
	},],
	['every log and message field set', {
		removalReasons: {
			logsub: 'modlogsub',
			logtitle: '[{kind}] {title} by {author}',
			logreason: 'removed by {mod}',
			pmsubject: 'Your {kind} in /r/{subreddit} was removed',
			typeReply: 'PM',
			removalOption: 'main',
			reasons: [{title: 'Spam', text: 'no spam',},],
		},
	},],
	['fully populated ban macros', {
		banMacros: {note: 'repeat offender', message: 'You are banned.', duration: 7, reason: 'spam',},
	},],
	['macro text with html-ish characters', {
		modMacros: [{title: 'Escalate', text: '<b>Escalated</b> & assigned to /u/mod',},],
	},],
	['substitution tokens', {
		removalReasons: {
			header: 'Hi {author},',
			footer: 'Your post: {uri_title}',
			reasons: [{title: 'Quote', text: 'You wrote:\n\n{body}\n\nRemoved from /r/{subreddit}.',},],
		},
	},],
	['a synced reason alongside hand-written ones', {
		removalReasons: {
			reasons: [
				{title: 'Spam', text: 'no spam',},
				{title: 'Rule 1', text: 'from reddit', nativeReasonId: 'native-1',},
			],
			nativeSync: {enabled: true, fingerprint: 'deadbeefdeadbeef', lastSyncedAt: 1700000000000,},
		},
	},],
]

describe('legacy mirror round trip is a fixed point', () => {
	it.each(fixedPointCases,)('reconciles as a no-op: %s', async (_name, partial,) => {
		const nxg = makeConfig(partial,)
		const mirror = encodeClassicConfig(nxg,) as unknown as Record<string, unknown>
		normalizeConfig(mirror,)
		readFromWiki.mockResolvedValue({ok: true, data: mirror,},)

		const result = await reconcileConfigFromLegacy('sub', nxg, canonicalAt1000,)

		// 'equal', not 'keptCanonical': the content guard must settle this, or a mirror
		// that happened to be newer would still clobber the canonical config.
		expect(result.outcome,).toBe('equal',)
		expect(result.config,).toBe(nxg,)
		expect(getWikiRevisions,).not.toHaveBeenCalled()
	},)
})

describe('v1 decode asymmetry', () => {
	// `encodeClassicConfig` escapes only the four fields 6.x unescapes, but the mirror is
	// written `ver: 1` and `normalizeConfig` URI-decodes every string on a v1 page. These
	// pin the resulting loss, which the mirror-view comparison routes around rather than
	// repairs - closing it at the source would change what a real 6.x edit is read as.
	it('URI-decodes mirrored fields the down-convert never escaped', () => {
		const nxg = makeConfig({
			removalReasons: {
				logtitle: 'Removed %E2%9C%93',
				reasons: [{title: 'Rule a%2Fb', text: 'see the wiki', flairText: 'a%2Fb',},],
			},
		},)
		const mirror = encodeClassicConfig(nxg,) as unknown as Record<string, unknown>
		normalizeConfig(mirror,)
		const decoded = mirror as unknown as ToolboxConfig

		expect(decoded.removalReasons.logtitle,).toBe('Removed ✓',)
		expect(decoded.removalReasons.reasons[0]!.title,).toBe('Rule a/b',)
		expect(decoded.removalReasons.reasons[0]!.flairText,).toBe('a/b',)
		// So a naive comparison against the NXG config reports a difference that no 6.x
		// mod made - the exact false positive the mirror-view comparison exists to absorb.
		expect(legacyOwnedFieldsEqual(nxg, decoded,),).toBe(false,)
		expect(legacyOwnedFieldsEqual(mirrorViewOfConfig(nxg,), decoded,),).toBe(true,)
	})
})
