/** Tests for normalizeConfig. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// The real webextension-polyfill throws at import time outside an extension
// context. A transitive import here pulls it in, so stub it like the other
// suites do to keep the module graph loadable under vitest.
vi.mock('webextension-polyfill', () => ({
	default: {
		runtime: {sendMessage: vi.fn(),},
		storage: {local: {get: vi.fn(), set: vi.fn(),},},
	},
}),)

// Domain tags and usernote colors are fetched from their own NXG pages during
// the legacy down-convert. Stub their sources to empty so these tests stay
// focused on the save/down-convert logic — color/tag injection is covered by
// codec.test.ts. Without this, the real sources fall back to the default color
// set and leak into every saveToolboxConfig assertion.
vi.mock('../domaintagger/moduleapi', () => ({
	getDomainTagsData: vi.fn().mockResolvedValue({tags: [],},),
}),)
vi.mock('../shared/usernotes/moduleapi', () => ({
	getSubredditColors: vi.fn().mockResolvedValue([],),
}),)

vi.mock('../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../api/resources/wiki', () => ({
	readFromWiki: vi.fn(),
	readWikiRevision: vi.fn(),
	getWikiRevisions: vi.fn().mockResolvedValue([],),
	postToWiki: vi.fn().mockResolvedValue(undefined,),
}),)
// The canonical config write goes through the revision-guarded transport; the
// legacy mirror uses postToWiki. Default to a clean commit; conflict/error cases
// override per-test.
const writeWikiPageConditional = vi.hoisted(() => vi.fn().mockResolvedValue({ok: true,},))
vi.mock('../../api/resources/wikiVersioned', () => ({writeWikiPageConditional,}),)
vi.mock('../../util/persistence/cache', () => ({
	getCache: vi.fn().mockImplementation((_moduleId: unknown, _key: unknown, defaultVal: unknown,) =>
		Promise.resolve(defaultVal,)
	),
	setCache: vi.fn().mockResolvedValue(undefined,),
	clearCache: vi.fn().mockResolvedValue(undefined,),
}),)
vi.mock('../../store', () => ({default: {dispatch: vi.fn(),},}),)
vi.mock('../../store/textFeedbackSlice', async (importOriginal,) => {
	const actual = await importOriginal<typeof import('../../store/textFeedbackSlice')>()
	return {...actual, showTextFeedback: vi.fn((msg: any,) => msg),}
},)
vi.mock('../../util/data/purify', () => ({purifyObject: vi.fn(),}),)
vi.mock('../../util/infra/logging', () => ({
	default: () => ({debug: vi.fn(), warn: vi.fn(), error: vi.fn(),}),
}),)
const getWikiWritePaths = vi.hoisted(() => vi.fn())
const resolveWikiLayout = vi.hoisted(() => vi.fn())
// These two are mocked only so the real wikiPaths module below can load
// without pulling browser-extension APIs in transitively.
vi.mock('../../api/resources/modSubs', () => ({isModSub: vi.fn(),}),)
vi.mock('../../util/wiki/wikiMigration', () => ({
	migrateSubredditToNxg: vi.fn(),
	bootstrapFreshSub: vi.fn(),
}),)
// Only the layout-resolution entry points are stubbed; the pure helpers
// (compatMirrorEnabled, isTombstone, path constants, …) come from the real
// module so the tests can't drift from its logic.
vi.mock('../../util/wiki/wikiPaths', async (importOriginal,) => {
	const actual = await importOriginal<typeof import('../../util/wiki/wikiPaths')>()
	return {
		...actual,
		getWikiWritePaths,
		resolveWikiLayout,
	}
},)

import {getWikiRevisions, postToWiki as tbApiPostToWiki, readFromWiki,} from '../../api/resources/wiki'
import {showTextFeedback, TextFeedbackKind,} from '../../store/textFeedbackSlice'
import {zlibDeflate, zlibInflate,} from '../../util/data/encoding'
import {purifyObject,} from '../../util/data/purify'
import {getCache, setCache,} from '../../util/persistence/cache'
import {normalizeConfig,} from '../../util/wiki/schemas/config/schema'
import {
	convertUsernotesEditorText,
	formatWikiEditorText,
	getConfig,
	getUsernotesEditorView,
	prepareWikiEditorContent,
	reloadConfigFromWiki,
	saveToolboxConfig,
	tryGetConfig,
} from './moduleapi'

describe('normalizeConfig', () => {
	it('backfills missing removal reasons config', () => {
		const configData: any = {}

		normalizeConfig(configData,)

		expect(configData.removalReasons,).toEqual({reasons: [],},)
	})

	it('normalizes legacy empty-string removal reasons config', () => {
		const configData: any = {removalReasons: '',}

		normalizeConfig(configData,)

		expect(configData.removalReasons,).toEqual({reasons: [],},)
	})

	it('preserves removal reasons settings while adding a missing reasons list', () => {
		const configData: any = {removalReasons: {header: 'hi', bantitle: 'unused',},}

		normalizeConfig(configData,)

		expect(configData.removalReasons,).toEqual({header: 'hi', reasons: [],},)
	})

	it('coerces legacy empty-string modMacros to an empty array', () => {
		const configData: any = {modMacros: '',}

		normalizeConfig(configData,)

		expect(configData.modMacros,).toEqual([],)
	})

	it('preserves a valid modMacros array and assigns stable ids', () => {
		const configData: any = {modMacros: [{text: 'hello',},],}

		normalizeConfig(configData,)

		expect(configData.modMacros[0].text,).toBe('hello',)
		expect(configData.modMacros[0].id,).toMatch(/^[a-z0-9]{8}$/,)
	})

	it('keeps valid suggestedReasons mappings, assigns stable ids, and minimizes optional fields', () => {
		const configData: any = {
			removalReasons: {
				reasons: [],
				suggestedReasons: [
					{
						pattern: 'low effort',
						includeUserReports: true,
						reasonIds: ['r1', '', 'r2',],
					},
					{pattern: 'plain', reasonIds: ['r3',],},
				],
			},
		}

		normalizeConfig(configData,)

		const [first, second,] = configData.removalReasons.suggestedReasons
		expect(first.pattern,).toBe('low effort',)
		expect(first.includeUserReports,).toBe(true,)
		expect(first.reasonIds,).toEqual(['r1', 'r2',],)
		expect(first.id,).toMatch(/^[a-z0-9]{8}$/,)
		// Absent optional fields stay absent.
		expect(second,).not.toHaveProperty('includeUserReports',)
	})

	it('drops suggestedReasons entries without a pattern or any reason ids, and an empty list entirely', () => {
		const configData: any = {
			removalReasons: {
				reasons: [],
				suggestedReasons: [
					{pattern: '', reasonIds: ['r1',],},
					{pattern: 'x', reasonIds: [],},
					{pattern: 'x', reasonIds: ['',],},
				],
			},
		}

		normalizeConfig(configData,)

		expect(configData.removalReasons,).not.toHaveProperty('suggestedReasons',)
	})

	it('drops a non-array suggestedReasons field', () => {
		const configData: any = {removalReasons: {reasons: [], suggestedReasons: 'nope',},}

		normalizeConfig(configData,)

		expect(configData.removalReasons,).not.toHaveProperty('suggestedReasons',)
	})

	it('removes domainTags from config (domain tags now live on a dedicated wiki page)', () => {
		const configData: any = {domainTags: [{name: 'example.com', color: 'red',},],}

		normalizeConfig(configData,)

		expect(configData.domainTags,).toBeUndefined()
	})

	it('removes usernoteColors from config (usernote types now live on the usernotes wiki page)', () => {
		const configData: any = {usernoteColors: [{key: 'spam', text: 'Spam', color: 'red',},],}

		normalizeConfig(configData,)

		expect(configData.usernoteColors,).toBeUndefined()
	})

	it('applies usernote save-requirement defaults when the fields are absent', () => {
		const configData: any = {}

		normalizeConfig(configData,)

		// type/link default off; text defaults on.
		expect(configData.requireUsernoteType,).toBe(false,)
		expect(configData.requireUsernoteText,).toBe(true,)
		expect(configData.requireUsernoteLink,).toBe(false,)
	})

	it('coerces garbage usernote save-requirement values to their defaults', () => {
		const configData: any = {
			requireUsernoteType: 'yes',
			requireUsernoteText: 0,
			requireUsernoteLink: 1,
		}

		normalizeConfig(configData,)

		// Only a literal true enables type/link; only a literal false disables text.
		expect(configData.requireUsernoteType,).toBe(false,)
		expect(configData.requireUsernoteText,).toBe(true,)
		expect(configData.requireUsernoteLink,).toBe(false,)
	})

	it('honors explicit usernote save-requirement values', () => {
		const configData: any = {
			requireUsernoteType: true,
			requireUsernoteText: false,
			requireUsernoteLink: true,
		}

		normalizeConfig(configData,)

		expect(configData.requireUsernoteType,).toBe(true,)
		expect(configData.requireUsernoteText,).toBe(false,)
		expect(configData.requireUsernoteLink,).toBe(true,)
	})

	it('coerces legacy empty-string banMacros to null', () => {
		const configData: any = {banMacros: '',}

		normalizeConfig(configData,)

		expect(configData.banMacros,).toBeNull()
	})

	it('preserves a valid banMacros object', () => {
		const banMacros = {
			banNote: 'note',
			banMessage: 'msg',
			defaultBanPermanent: true,
			defaultBanDuration: 0,
			banDurationPresets: [],
		}
		const configData: any = {banMacros,}

		normalizeConfig(configData,)

		expect(configData.banMacros,).toEqual(banMacros,)
	})

	it('leaves guardedActions absent (absent ⇒ all actions guarded)', () => {
		const configData: any = {}

		normalizeConfig(configData,)

		expect(configData.guardedActions,).toBeUndefined()
	})

	it('keeps only recognized action types in an explicit guardedActions list', () => {
		const configData: any = {guardedActions: ['remove', 'approve', 'bogus', 42, 'ban',],}

		normalizeConfig(configData,)

		expect(configData.guardedActions,).toEqual(['remove', 'approve', 'ban',],)
	})

	it('preserves an explicit empty guardedActions array (guard nothing)', () => {
		const configData: any = {guardedActions: [],}

		normalizeConfig(configData,)

		expect(configData.guardedActions,).toEqual([],)
	})

	it('coerces a non-array guardedActions to an empty array', () => {
		const configData: any = {guardedActions: 'remove',}

		normalizeConfig(configData,)

		expect(configData.guardedActions,).toEqual([],)
	})

	it('migrates a config with no ver to the current schema version', () => {
		const configData: any = {}

		normalizeConfig(configData,)

		expect(configData.ver,).toBe(2,)
	})

	it('migrates v1 escaped text and limited-HTML fields to plain v2 tokens', () => {
		const configData: any = {
			ver: 1,
			removalReasons: {
				// escape()-encoded, as written by 6.x: 'Pick <select id="r"><option>a</option></select>'
				reasons: [{text: 'Pick%20%3Cselect%20id%3D%22r%22%3E%3Coption%3Ea%3C/option%3E%3C/select%3E',},],
				header: 'hello%20there',
			},
		}

		normalizeConfig(configData,)

		expect(configData.ver,).toBe(2,)
		expect(configData.removalReasons.reasons[0].text,).toBe('Pick\n\n{choice#r}\n- a',)
		expect(configData.removalReasons.reasons[0].selects,).toBeUndefined()
		expect(configData.removalReasons.header,).toBe('hello there',)
	})

	it('heals v2 reason text where entity-escaped legacy HTML survived', () => {
		// A v2 page whose entity-escaped legacy HTML gained extra &amp; layers
		// from content_md round trips.
		const configData: any = {
			ver: 2,
			removalReasons: {
				reasons: [{
					text: 'Pick &amp;amp;lt;select id="r"&amp;amp;gt;&amp;amp;lt;option&amp;amp;gt;a'
						+ '&amp;amp;lt;/option&amp;amp;gt;&amp;amp;lt;/select&amp;amp;gt;',
				},],
			},
		}

		normalizeConfig(configData,)

		expect(configData.removalReasons.reasons[0].text,).toBe('Pick\n\n{choice#r}\n- a',)
		expect(configData.removalReasons.reasons[0].selects,).toBeUndefined()
	})

	it('migrates the older v2 separate-definitions shape to an inline {choice} block', () => {
		const configData: any = {
			ver: 2,
			removalReasons: {
				reasons: [{
					text: 'Pick {select:rule}',
					selects: [{name: 'rule', prompt: 'Which rule?', options: ['Rule 1', 'Rule 2',],},],
				},],
			},
		}

		normalizeConfig(configData,)

		expect(configData.removalReasons.reasons[0].text,)
			.toBe('Pick\n\nWhich rule?\n\n{choice#rule}\n- Rule 1\n- Rule 2',)
		expect(configData.removalReasons.reasons[0].selects,).toBeUndefined()

		// Idempotent: a second normalize leaves the migrated text unchanged.
		const once = configData.removalReasons.reasons[0].text
		normalizeConfig(configData,)
		expect(configData.removalReasons.reasons[0].text,).toBe(once,)
	})

	it('does not URI-decode v2 configs', () => {
		const configData: any = {
			ver: 2,
			removalReasons: {reasons: [{text: 'literal %20 stays',},],},
		}

		normalizeConfig(configData,)

		expect(configData.removalReasons.reasons[0].text,).toBe('literal %20 stays',)
	})

	it('keeps existing stable ids and fills in missing ones', () => {
		const configData: any = {
			ver: 2,
			removalReasons: {reasons: [{id: 'keepthis', text: 'a',}, {text: 'b',},],},
		}

		normalizeConfig(configData,)

		expect(configData.removalReasons.reasons[0].id,).toBe('keepthis',)
		expect(configData.removalReasons.reasons[1].id,).toMatch(/^[a-z0-9]{8}$/,)
	})
})

describe('getConfig', () => {
	beforeEach(() => {
		vi.mocked(getCache,).mockImplementation((_moduleId, _key, defaultVal,) => Promise.resolve(defaultVal,))
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'legacyFallback', compatibilityWrites: false,},
		)
	},)
	afterEach(() => {
		vi.clearAllMocks()
	},)

	it('returns undefined for a cached no-config sub without calling the wiki', async () => {
		vi.mocked(getCache,).mockImplementation((_moduleId, key, defaultVal,) =>
			Promise.resolve(key === 'noConfig' ? ['nosub',] : defaultVal,)
		)

		const result = await getConfig('nosub',)

		expect(result,).toBeUndefined()
		expect(readFromWiki,).not.toHaveBeenCalled()
	})

	it('reports a user-profile pseudo-sub as absent without touching the wiki or layout', async () => {
		// Reddit lists the viewer's own profile (`u_<username>`) among moderated subs, but it
		// has no toolbox wiki — tryGetConfig must short-circuit before any wiki/layout work so
		// a profile page doesn't fire doomed config reads.
		const result = await tryGetConfig('u_alice',)

		expect(result,).toEqual({status: 'absent',},)
		expect(await getConfig('u_alice',),).toBeUndefined()
		expect(readFromWiki,).not.toHaveBeenCalled()
		expect(resolveWikiLayout,).not.toHaveBeenCalled()
	})

	it('reports a non-moderated sub as absent without reading the settings page', async () => {
		// The layout resolver default-denies non-moderated subs to a read-free `notModerated`
		// layout; tryGetConfig must honor it and report a definite "no config" without reading.
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: false, notModerated: true,},
		)

		const result = await tryGetConfig('sub',)

		expect(result,).toEqual({status: 'absent',},)
		expect(readFromWiki,).not.toHaveBeenCalled()
	})

	it('forwards allowNonModerated to the layout resolver for cross-sub reads', async () => {
		// Shared removal reasons (`getfrom`) read a sub the viewer may not moderate, so the
		// opt-in must reach the resolver and let the read through.
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'src', state: 'nxg', compatibilityWrites: false,},
		)
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: {},},)

		await tryGetConfig('src', {allowNonModerated: true,},)

		expect(resolveWikiLayout,).toHaveBeenCalledWith('src', {allowNonModerated: true,},)
		expect(readFromWiki,).toHaveBeenCalled()
	})

	it('returns cached config data without calling the wiki when the base rev is also cached', async () => {
		const cached = {removalReasons: {header: 'hi',},}
		vi.mocked(getCache,).mockImplementation((_moduleId, key, defaultVal,) =>
			Promise.resolve(
				key === 'configCache' ? {sub: cached,} : key === 'configRev' ? {sub: 'rev-1',} : defaultVal,
			)
		)

		const result = await getConfig('sub',)

		expect(result,).toBe(cached,)
		expect(result?.removalReasons,).toEqual({header: 'hi', reasons: [],},)
		expect(readFromWiki,).not.toHaveBeenCalled()
	})

	it('treats a cached config without a cached base rev as a miss and re-reads the wiki', async () => {
		// A cached config with no companion `configRev` entry (a pre-rev-tracking cache, or a
		// failed rev stash) must not be served from cache: a save off it would be unguarded
		// (last-write-wins). Fall through to a fresh read so the base rev gets re-stashed.
		const cached = {removalReasons: {header: 'stale',},}
		const fresh = {removalReasons: {header: 'fresh',},}
		vi.mocked(getCache,).mockImplementation((_moduleId, key, defaultVal,) =>
			Promise.resolve(key === 'configCache' ? {sub: cached,} : defaultVal,)
		)
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: fresh,},)
		vi.mocked(getWikiRevisions,).mockResolvedValueOnce([{id: 'rev-fresh',},] as any,)

		const result = await getConfig('sub',)

		expect(readFromWiki,).toHaveBeenCalled()
		expect(result,).toBe(fresh,)
		// The fresh read stashes the base rev so the next save is guarded.
		expect(setCache,).toHaveBeenCalledWith('utils', 'configRev', {sub: 'rev-fresh',},)
	})

	it('returns undefined and caches the sub when no_page', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: false, reason: 'no_page',},)

		const result = await getConfig('sub',)

		expect(result,).toBeUndefined()
		expect(setCache,).toHaveBeenCalledWith('utils', 'noConfig', ['sub',],)
	})

	it('returns undefined when wiki returns unknown_error', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: false, reason: 'unknown_error',},)

		const result = await getConfig('sub',)

		expect(result,).toBeUndefined()
		expect(setCache,).not.toHaveBeenCalled()
	})

	it('returns undefined when wiki returns invalid_json', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: false, reason: 'invalid_json',},)

		const result = await getConfig('sub',)

		expect(result,).toBeUndefined()
	})

	it('purifies, caches, and returns valid wiki data', async () => {
		const configData = {removalReasons: {header: 'test',},}
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: configData,},)
		vi.mocked(getCache,).mockImplementation((_moduleId, key, defaultVal,) =>
			Promise.resolve(key === 'configCache' ? {} : defaultVal,)
		)
		// A fresh read stashes the page revision so the next save can condition on it.
		vi.mocked(getWikiRevisions,).mockResolvedValueOnce([{id: 'rev-x',},] as any,)

		const result = await getConfig('sub',)

		expect(purifyObject,).toHaveBeenCalledWith(configData,)
		expect(setCache,).toHaveBeenCalledWith('utils', 'configCache', {sub: configData,},)
		expect(setCache,).toHaveBeenCalledWith('utils', 'configRev', {sub: 'rev-x',},)
		expect(result,).toBe(configData,)
	})

	it('reads the NXG page for compat-off subs', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: false,},
		)
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: {},},)

		await getConfig('sub',)

		expect(readFromWiki,).toHaveBeenCalledWith('sub', 'toolbox-nxg', true,)
	})

	it('compat-on: adopts 6.x edits from a diverged legacy mirror', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: true,},
		)
		const nxgData = {
			ver: 2,
			removalReasons: {reasons: [{id: 'aaaaaaaa', title: 'Spam', text: 'No spam',},],},
		}
		const legacyData = {
			ver: 1,
			removalReasons: {
				reasons: [
					{title: 'Spam', text: 'No spam',},
					{title: 'New from 6.x', text: 'Added on the old page',},
				],
			},
		}
		vi.mocked(readFromWiki,).mockImplementation(async (_sub: string, page: string,) =>
			page === 'toolbox-nxg'
				? {ok: true, data: nxgData,} as any
				: {ok: true, data: legacyData,} as any
		)

		const result = await getConfig('sub',)

		const reasons = result!.removalReasons.reasons
		expect(reasons.map((r,) => r.title),).toEqual(['Spam', 'New from 6.x',],)
		// The content-matched entry keeps its NXG id; the new one gets a fresh id.
		expect(reasons[0]!.id,).toBe('aaaaaaaa',)
		expect(reasons[1]!.id,).toMatch(/^[a-z0-9]{8}$/,)
	})

	it('compat-on: an agreeing legacy mirror changes nothing', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: true,},
		)
		const nxgData = {
			ver: 2,
			removalReasons: {reasons: [{id: 'aaaaaaaa', title: 'Spam', text: 'No spam',},],},
		}
		// The mirror matches modulo the stripped id.
		const legacyData = {ver: 1, removalReasons: {reasons: [{title: 'Spam', text: 'No spam',},],},}
		vi.mocked(readFromWiki,).mockImplementation(async (_sub: string, page: string,) =>
			page === 'toolbox-nxg'
				? {ok: true, data: nxgData,} as any
				: {ok: true, data: legacyData,} as any
		)

		const result = await getConfig('sub',)

		expect(result,).toBe(nxgData,)
	})
})

describe('reloadConfigFromWiki', () => {
	beforeEach(() => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'legacyFallback', compatibilityWrites: false,},
		)
	},)
	afterEach(() => {
		vi.clearAllMocks()
	},)

	it('reads the resolved canonical page, bypassing the cache', async () => {
		const configData = {modMacros: [],}
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: false,},
		)
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: configData,},)

		const result = await reloadConfigFromWiki('sub',)

		expect(readFromWiki,).toHaveBeenCalledWith('sub', 'toolbox-nxg', true,)
		expect(purifyObject,).toHaveBeenCalledWith(configData,)
		expect(result,).toBe(configData,)
		expect(getCache,).not.toHaveBeenCalled()
	})

	it('returns null when the read fails', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: false, reason: 'no_page',},)

		expect(await reloadConfigFromWiki('sub',),).toBeNull()
	})

	it('returns null for a non-moderated sub without reading', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: false, notModerated: true,},
		)

		expect(await reloadConfigFromWiki('sub',),).toBeNull()
		expect(readFromWiki,).not.toHaveBeenCalled()
	})
})

describe('saveToolboxConfig', () => {
	beforeEach(() => {
		document.body.innerHTML = ''
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'legacyFallback', compatibilityWrites: false,},
		)
		getWikiWritePaths.mockResolvedValue(['toolbox',],)
		vi.mocked(tbApiPostToWiki,).mockResolvedValue(undefined,)
		// Reset the guarded canonical write to a clean commit (clearAllMocks keeps
		// implementations, so a prior conflict/error case would otherwise leak in).
		writeWikiPageConditional.mockResolvedValue({ok: true,},)
	},)
	afterEach(() => {
		vi.clearAllMocks()
	},)

	it('writes the classic-schema config to the resolved legacy page', async () => {
		await saveToolboxConfig('sub', {foo: 'bar',}, 'test reason',)

		// In legacy-fallback mode the legacy page is the canonical page, so it goes
		// through the revision-guarded write (not the mirror postToWiki path).
		expect(writeWikiPageConditional,).toHaveBeenCalledWith(
			'sub',
			'toolbox',
			{foo: 'bar', ver: 1,},
			'test reason',
			undefined,
			expect.anything(),
			{listed: 'true',},
		)
	})

	it('down-converts token text and strips ids on the legacy copy only', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: true,},
		)
		getWikiWritePaths.mockResolvedValue(['toolbox-nxg', 'toolbox',],)
		const config: any = {
			ver: 2,
			removalReasons: {
				reasons: [{
					id: 'r1idr1id',
					text: '{choice#r}\n- a',
				},],
			},
			modMacros: [],
		}

		await saveToolboxConfig('sub', config, 'reason',)

		// The legacy copy is the mirror (postToWiki); the NXG copy is the canonical,
		// revision-guarded write.
		const legacyWrite = vi.mocked(tbApiPostToWiki,).mock.calls.find((call,) => call[1] === 'toolbox')!
		const nxgWrite = writeWikiPageConditional.mock.calls.find((call,) => call[1] === 'toolbox-nxg')!
		const legacyReason = (legacyWrite[2] as any).removalReasons.reasons[0]
		expect((legacyWrite[2] as any).ver,).toBe(1,)
		expect(legacyReason.id,).toBeUndefined()
		// eslint-disable-next-line no-restricted-globals
		expect(unescape(legacyReason.text,),).toBe('<select id="r"><option>a</option></select>',)
		// The NXG copy keeps the v2 shape untouched.
		const nxgReason = (nxgWrite[2] as any).removalReasons.reasons[0]
		expect((nxgWrite[2] as any).ver,).toBe(2,)
		expect(nxgReason,).toEqual({
			id: 'r1idr1id',
			text: '{choice#r}\n- a',
		},)
	})

	it('fans out to both pages in compat-on mode, embedding the flag only in the NXG copy', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: true,},
		)
		getWikiWritePaths.mockResolvedValue(['toolbox-nxg', 'toolbox',],)

		await saveToolboxConfig('sub', {foo: 'bar',}, 'reason',)

		// Canonical NXG via the guarded write; legacy mirror via postToWiki.
		expect(tbApiPostToWiki,).toHaveBeenCalledTimes(1,)
		expect(tbApiPostToWiki,).toHaveBeenCalledWith(
			'sub',
			'toolbox',
			{foo: 'bar', ver: 1,},
			'reason',
			true,
			false,
		)
		expect(writeWikiPageConditional,).toHaveBeenCalledWith(
			'sub',
			'toolbox-nxg',
			{'foo': 'bar', 'Toolbox.Utils.compatibilityWrites': true,},
			'reason',
			undefined,
			expect.anything(),
			{listed: 'true',},
		)
	})

	it('writes the canonical NXG page first and tolerates a legacy mirror failure', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: true,},
		)
		getWikiWritePaths.mockResolvedValue(['toolbox-nxg', 'toolbox',],)
		vi.mocked(tbApiPostToWiki,).mockRejectedValue(new Error('mirror write failed',),)

		// Resolves despite the mirror failure: the canonical NXG write committed.
		await saveToolboxConfig('sub', {foo: 'bar',}, 'reason',)

		// Canonical NXG goes through the guarded write; the mirror (postToWiki) failed.
		expect(writeWikiPageConditional,).toHaveBeenCalledWith(
			'sub',
			'toolbox-nxg',
			expect.anything(),
			'reason',
			undefined,
			expect.anything(),
			{listed: 'true',},
		)
		expect(tbApiPostToWiki,).toHaveBeenCalledWith('sub', 'toolbox', expect.anything(), 'reason', true, false,)
		// The save still reports overall success after warning about the mirror.
		expect(showTextFeedback,).toHaveBeenCalledWith(
			expect.objectContaining({kind: TextFeedbackKind.Positive,},),
		)
	})

	it('warns and skips the save when a concurrent edit conflicts (no clobber)', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: true,},
		)
		getWikiWritePaths.mockResolvedValue(['toolbox-nxg', 'toolbox',],)
		writeWikiPageConditional.mockResolvedValue({
			ok: false,
			conflict: true,
			data: {ver: 2,},
			rev: 'newrev',
		},)

		await saveToolboxConfig('sub', {foo: 'bar',}, 'reason',)

		// The mirror is never written, and the user is warned their change didn't save.
		expect(tbApiPostToWiki,).not.toHaveBeenCalled()
		expect(showTextFeedback,).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('changed elsewhere',),
				kind: TextFeedbackKind.Negative,
			},),
		)
		expect(showTextFeedback,).not.toHaveBeenCalledWith(
			expect.objectContaining({kind: TextFeedbackKind.Positive,},),
		)
	})

	it('strips layout metadata from the legacy copy', async () => {
		resolveWikiLayout.mockResolvedValue(
			{subreddit: 'sub', state: 'nxg', compatibilityWrites: true,},
		)
		getWikiWritePaths.mockResolvedValue(['toolbox-nxg', 'toolbox',],)

		await saveToolboxConfig('sub', {'foo': 'bar', 'Toolbox.Utils.compatibilityWrites': true,}, 'reason',)

		expect(tbApiPostToWiki,).toHaveBeenCalledWith(
			'sub',
			'toolbox',
			{foo: 'bar', ver: 1,},
			'reason',
			true,
			false,
		)
	})

	it('conditions the canonical write on the stashed base revision (cache-hit reads too)', async () => {
		// A base rev stashed by an earlier getConfig — including a cache-hit read in another
		// tab or after a reload — lives in the persistent `configRev` cache, so the guarded
		// write conditions on it instead of falling back to last-write-wins.
		vi.mocked(getCache,).mockImplementation((_moduleId, key, defaultVal,) =>
			Promise.resolve(key === 'configRev' ? {sub: 'rev-123',} : defaultVal,)
		)

		await saveToolboxConfig('sub', {foo: 'bar',}, 'reason',)

		expect(writeWikiPageConditional,).toHaveBeenCalledWith(
			'sub',
			'toolbox',
			{foo: 'bar', ver: 1,},
			'reason',
			'rev-123',
			expect.anything(),
			{listed: 'true',},
		)
	})

	it('shows neutral feedback while saving and positive feedback on success', async () => {
		await saveToolboxConfig('sub', {}, 'reason',)

		expect(showTextFeedback,).toHaveBeenCalledWith(
			expect.objectContaining({message: 'saving to wiki', kind: TextFeedbackKind.Neutral,},),
		)
		expect(showTextFeedback,).toHaveBeenCalledWith(
			expect.objectContaining({message: 'wiki page saved', kind: TextFeedbackKind.Positive,},),
		)
	})

	it('shows negative feedback on failure without rejecting', async () => {
		// The canonical write (the guarded transport in legacy-fallback mode) fails.
		writeWikiPageConditional.mockResolvedValue({
			ok: false,
			conflict: false,
			error: new Error('network error',),
		},)

		await saveToolboxConfig('sub', {}, 'reason',)

		expect(showTextFeedback,).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('network error',),
				kind: TextFeedbackKind.Negative,
			},),
		)
	})
})

describe('formatWikiEditorText', () => {
	const jsonOpts = {isUsernotes: false, isAutomod: false,}

	it('pretty-prints JSON pages', () => {
		expect(formatWikiEditorText('{"a":1}', jsonOpts,),).toBe('{\n    "a": 1\n}',)
	})

	it('returns AutoModerator YAML verbatim', () => {
		const yaml = 'type: comment\naction: remove'
		expect(formatWikiEditorText(yaml, {isUsernotes: false, isAutomod: true,},),).toBe(yaml,)
	})

	it('expands the blob of v6 usernotes pages', () => {
		const users = {someuser: {ns: [{n: 'note', t: 0, m: 0, l: '', w: 0,},],},}
		const page = JSON.stringify({
			ver: 6,
			constants: {users: ['mod',], warnings: ['',],},
			blob: zlibDeflate(
				JSON.stringify(users,),
			),
		},)

		const text = formatWikiEditorText(page, {isUsernotes: true, isAutomod: false,},)
		const parsed = JSON.parse(text,)

		expect(parsed.blob,).toBeUndefined()
		expect(parsed.users,).toEqual(users,)
	})
})

describe('prepareWikiEditorContent', () => {
	const usernotesOpts = {isUsernotes: true, isAutomod: false,}

	it('passes AutoModerator YAML through verbatim', async () => {
		const yaml = 'type: comment\naction: remove'
		await expect(prepareWikiEditorContent(yaml, {isUsernotes: false, isAutomod: true,},),).resolves.toEqual(
			{ok: true, content: yaml,},
		)
	})

	it('rejects invalid JSON with a message', async () => {
		const result = await prepareWikiEditorContent('{nope', {isUsernotes: false, isAutomod: false,},)
		expect(result.ok,).toBe(false,)
	})

	it('minifies valid JSON', async () => {
		await expect(prepareWikiEditorContent('{\n  "a": 1\n}', {isUsernotes: false, isAutomod: false,},),)
			.resolves.toEqual({ok: true, content: '{"a":1}',},)
	})

	it('recompresses the blob of expanded v6 usernotes', async () => {
		const users = {someuser: {ns: [{n: 'note', t: 0, m: 0, l: '', w: 0,},],},}
		const expanded = JSON.stringify({ver: 6, constants: {users: [], warnings: [],}, users,},)

		const result = await prepareWikiEditorContent(expanded, usernotesOpts,)

		expect(result.ok,).toBe(true,)
		const saved = JSON.parse((result as {ok: true; content: string}).content,)
		expect(saved.users,).toBeUndefined()
		expect(JSON.parse(zlibInflate(saved.blob,),),).toEqual(users,)
	})

	it('leaves v6 pages that still have their blob untouched apart from minifying', async () => {
		const page = {ver: 6, constants: {}, blob: 'abc',}

		await expect(prepareWikiEditorContent(JSON.stringify(page, null, 4,), usernotesOpts,),).resolves.toEqual(
			{ok: true, content: JSON.stringify(page,),},
		)
	})
})

describe('getUsernotesEditorView', () => {
	it('classifies v6 blob pages as compressed', () => {
		expect(getUsernotesEditorView('{"ver":6,"blob":"abc"}',),).toBe('compressed',)
	})

	it('classifies expanded v6 JSON as decompressed', () => {
		expect(getUsernotesEditorView('{"ver":6,"users":{}}',),).toBe('decompressed',)
	})

	it('classifies anything else as null', () => {
		expect(getUsernotesEditorView('getting wiki data...',),).toBeNull()
		expect(getUsernotesEditorView('',),).toBeNull()
		expect(getUsernotesEditorView('{"ver":1,"removalReasons":{}}',),).toBeNull()
		// The NXG shard manifest is not editable as usernotes data.
		expect(getUsernotesEditorView('{"format":"tbun-manifest","ver":7,"gen":1,"shards":[]}',),).toBeNull()
		// Non-JSON text is not recognized.
		expect(getUsernotesEditorView('definitely not json',),).toBeNull()
	})
})

describe('convertUsernotesEditorText', () => {
	it('expands a v6 blob into pretty JSON', async () => {
		const users = {someuser: {ns: [],},}
		const page = JSON.stringify({ver: 6, blob: zlibDeflate(JSON.stringify(users,),),},)

		const result = await convertUsernotesEditorText(page, 'decompressed',)

		expect(result.ok,).toBe(true,)
		expect(JSON.parse((result as {ok: true; text: string}).text,).users,).toEqual(users,)
	})

	it('re-deflates expanded v6 JSON into its blob', async () => {
		const users = {someuser: {ns: [],},}
		const result = await convertUsernotesEditorText(
			JSON.stringify({ver: 6, users,},),
			'compressed',
		)

		expect(result.ok,).toBe(true,)
		const parsed = JSON.parse((result as {ok: true; text: string}).text,)
		expect(parsed.users,).toBeUndefined()
		expect(JSON.parse(zlibInflate(parsed.blob,),),).toEqual(users,)
	})

	it('is a no-op when the text is already in the requested form', async () => {
		const page = '{"ver":6,"blob":"abc"}'
		await expect(convertUsernotesEditorText(page, 'compressed',),).resolves.toEqual(
			{ok: true, text: page,},
		)
	})

	it('reports unrecognized text', async () => {
		await expect(convertUsernotesEditorText('not usernotes', 'compressed',),).resolves.toMatchObject(
			{ok: false,},
		)
	})
})

describe('NXG shard envelope handling', () => {
	const usernotesOpts = {isUsernotes: true, isAutomod: false,}
	const shardUsers = {someuser: {nextIndex: 1, notes: [{index: 0, note: 'n', time: 0, mod: 'm',},],},}

	it('classifies a shard envelope with a blob as compressed', () => {
		expect(getUsernotesEditorView('{"format":"nxg-usernotes","ver":1,"blob":"abc"}',),).toBe('compressed',)
	})

	it('classifies an expanded shard envelope as decompressed', () => {
		expect(getUsernotesEditorView('{"format":"nxg-usernotes","ver":1,"users":{}}',),).toBe('decompressed',)
	})

	it('expands a shard blob into editable JSON and re-deflates it', async () => {
		const page = JSON.stringify({
			format: 'nxg-usernotes',
			ver: 1,
			blob: zlibDeflate(JSON.stringify(shardUsers,),),
		},)

		const expanded = await convertUsernotesEditorText(page, 'decompressed',)
		expect(expanded.ok,).toBe(true,)
		const expandedParsed = JSON.parse((expanded as {ok: true; text: string}).text,)
		expect(expandedParsed.blob,).toBeUndefined()
		expect(expandedParsed.users,).toEqual(shardUsers,)

		const compressed = await convertUsernotesEditorText((expanded as {ok: true; text: string}).text, 'compressed',)
		expect(compressed.ok,).toBe(true,)
		const compressedParsed = JSON.parse((compressed as {ok: true; text: string}).text,)
		expect(compressedParsed.users,).toBeUndefined()
		expect(JSON.parse(zlibInflate(compressedParsed.blob,),),).toEqual(shardUsers,)
	})

	it('recompresses an expanded shard envelope on save', async () => {
		const expanded = JSON.stringify({format: 'nxg-usernotes', ver: 1, users: shardUsers,},)

		const result = await prepareWikiEditorContent(expanded, usernotesOpts,)

		expect(result.ok,).toBe(true,)
		const saved = JSON.parse((result as {ok: true; content: string}).content,)
		expect(saved.users,).toBeUndefined()
		expect(JSON.parse(zlibInflate(saved.blob,),),).toEqual(shardUsers,)
	})
})
