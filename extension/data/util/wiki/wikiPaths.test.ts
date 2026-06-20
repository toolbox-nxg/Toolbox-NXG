/** Tests for the wiki layout resolver. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readFromWiki = vi.hoisted(() => vi.fn())
const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())
const negativeTextFeedback = vi.hoisted(() => vi.fn())
const isModSub = vi.hoisted(() => vi.fn())
const migrateSubredditToNxg = vi.hoisted(() => vi.fn())
const bootstrapFreshSub = vi.hoisted(() => vi.fn())

vi.mock('../../api/resources/wiki', () => ({readFromWiki,}),)
vi.mock('../../api/resources/modSubs', () => ({isModSub,}),)
vi.mock('../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../store/feedback', () => ({negativeTextFeedback,}),)
vi.mock('../persistence/cache', () => ({getCache, setCache,}),)
vi.mock('./wikiMigration', () => ({migrateSubredditToNxg, bootstrapFreshSub,}),)
vi.mock('../infra/logging', () => ({
	default: () => ({debug: vi.fn(), warn: vi.fn(), error: vi.fn(),}),
}),)

import {clearWikiLayoutCache, getCachedWikiLayouts,} from './wikiLayoutCache'
import {
	getNotePagePrefix,
	getNoteReadPath,
	getNoteWritePaths,
	getWikiReadPath,
	getWikiWritePaths,
	peekWikiLayout,
	resolveWikiLayout,
} from './wikiPaths'

/** Sets up readFromWiki to answer per-page, treating unlisted pages as missing. */
function mockWikiPages (pages: Record<string, any>,) {
	readFromWiki.mockImplementation((_sub: string, page: string,) =>
		Promise.resolve(
			page in pages
				? {ok: true, data: pages[page],}
				: {ok: false, reason: 'no_page',},
		)
	)
}

beforeEach(async () => {
	vi.clearAllMocks()
	getCache.mockImplementation((_moduleId: unknown, _key: unknown, defaultVal: unknown,) =>
		Promise.resolve(defaultVal,)
	)
	setCache.mockResolvedValue(undefined,)
	// The resolver now default-denies subs the viewer doesn't moderate to a read-free
	// `notModerated` layout, so the read/bootstrap/path logic most tests exercise only
	// runs for moderators (or opt-in reads). Default to "moderates"; the dedicated
	// non-mod / opt-in tests flip this to false.
	isModSub.mockResolvedValue(true,)
	migrateSubredditToNxg.mockResolvedValue({copied: ['toolbox-nxg',], skipped: [], failed: [],},)
	bootstrapFreshSub.mockResolvedValue({copied: ['toolbox-nxg',], skipped: [], failed: [],},)
	await clearWikiLayoutCache()
},)

describe('resolveWikiLayout', () => {
	it('resolves migrated compat-on from the NXG page flag without further reads', async () => {
		mockWikiPages({'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': true,},},)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'nxg', compatibilityWrites: true,},)
		expect(readFromWiki,).toHaveBeenCalledTimes(1,)
		expect(readFromWiki,).toHaveBeenCalledWith('sub', 'toolbox-nxg', true,)
	})

	it('resolves migrated compat-off and persists the layout', async () => {
		mockWikiPages({'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': false,},},)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'nxg', compatibilityWrites: false,},)
		expect(setCache,).toHaveBeenCalledWith('utils', 'wikiLayoutCache', {sub: layout,},)
	})

	it('falls back on the legacy page to infer a missing compat flag', async () => {
		mockWikiPages({
			'toolbox-nxg': {someConfig: true,},
			'toolbox': {realConfig: true,},
		},)

		expect((await resolveWikiLayout('withlegacy',)).compatibilityWrites,).toBe(true,)

		await clearWikiLayoutCache()
		mockWikiPages({'toolbox-nxg': {someConfig: true,},},)
		expect((await resolveWikiLayout('withlegacy',)).compatibilityWrites,).toBe(false,)
	})

	it('default-denies a sub the viewer does not moderate to notModerated without any read', async () => {
		mockWikiPages({'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': true,},},)
		isModSub.mockResolvedValue(false,)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'nxg', compatibilityWrites: false, notModerated: true,},)
		// No wiki reads fired for a sub Toolbox has no business reading.
		expect(readFromWiki,).not.toHaveBeenCalled()
		// Session-only so getting modded later re-resolves next session.
		expect(setCache,).not.toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			expect.objectContaining({sub: expect.anything(),},),
		)
	})

	it('fails closed to notModerated (no reads) when the mod-status lookup throws', async () => {
		// A transient isModSub failure must not read mod-only wiki pages at a sub the viewer
		// may not moderate (which 403 and trips a false training-mode icon downstream).
		mockWikiPages({'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': true,},},)
		isModSub.mockRejectedValue(new Error('network',),)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'nxg', compatibilityWrites: false, notModerated: true,},)
		// No wiki reads fired for a sub whose mod status we couldn't confirm.
		expect(readFromWiki,).not.toHaveBeenCalled()
		// Not cached, so the next resolution retries once the mod-subs list recovers.
		expect(setCache,).not.toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			expect.objectContaining({sub: expect.anything(),},),
		)
	})

	it('with allowNonModerated, classifies a non-mod sub with no legacy pages as nxg after probing usernotes', async () => {
		mockWikiPages({},)
		isModSub.mockResolvedValue(false,)

		const layout = await resolveWikiLayout('sub', {allowNonModerated: true,},)

		expect(layout,).toMatchObject({state: 'nxg', compatibilityWrites: false,},)
		expect(readFromWiki,).toHaveBeenCalledWith('sub', 'usernotes', false,)
		expect(bootstrapFreshSub,).not.toHaveBeenCalled()
		// Session-only so getting modded triggers a bootstrap next session.
		expect(setCache,).not.toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			expect.objectContaining({sub: expect.anything(),},),
		)
	})

	it('with allowNonModerated, classifies a non-mod usernotes-only sub (no toolbox page) as legacyFallback', async () => {
		mockWikiPages({usernotes: 'raw blob',},)
		isModSub.mockResolvedValue(false,)

		const layout = await resolveWikiLayout('sub', {allowNonModerated: true,},)

		expect(layout,).toMatchObject(
			{state: 'legacyFallback', compatibilityWrites: false, fallbackReason: 'notMod',},
		)
		expect(migrateSubredditToNxg,).not.toHaveBeenCalled()
	})

	it('with allowNonModerated, resolves non-mod legacy subs to legacy paths and persists', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)
		isModSub.mockResolvedValue(false,)

		const layout = await resolveWikiLayout('sub', {allowNonModerated: true,},)

		expect(layout,).toMatchObject({state: 'legacyFallback', fallbackReason: 'notMod',},)
		expect(negativeTextFeedback,).not.toHaveBeenCalled()
		expect(setCache,).toHaveBeenCalledWith('utils', 'wikiLayoutCache', {sub: layout,},)
	})

	it('bootstraps fresh subs the user moderates with a default config page', async () => {
		mockWikiPages({},)
		isModSub.mockResolvedValue(true,)

		const layout = await resolveWikiLayout('sub',)

		expect(bootstrapFreshSub,).toHaveBeenCalledExactlyOnceWith('sub',)
		expect(migrateSubredditToNxg,).not.toHaveBeenCalled()
		expect(layout,).toMatchObject({state: 'nxg', compatibilityWrites: false,},)
	})

	it('auto-migrates legacy subs the user moderates with compat ON', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)
		isModSub.mockResolvedValue(true,)

		const layout = await resolveWikiLayout('sub',)

		expect(migrateSubredditToNxg,).toHaveBeenCalledExactlyOnceWith('sub', {compatibilityWrites: true,},)
		expect(bootstrapFreshSub,).not.toHaveBeenCalled()
		expect(layout,).toMatchObject({state: 'nxg', compatibilityWrites: true,},)
	})

	it('degrades to a session-only legacyFallback with one toast when the bootstrap fails', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)
		isModSub.mockResolvedValue(true,)
		migrateSubredditToNxg.mockResolvedValue(
			{copied: [], skipped: [], failed: [{page: 'toolbox-nxg', reason: 'rate limited',},],},
		)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'legacyFallback', fallbackReason: 'bootstrapFailed',},)
		expect(negativeTextFeedback,).toHaveBeenCalledTimes(1,)
		// Session-only: the next session retries the bootstrap.
		expect(setCache,).not.toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			expect.objectContaining({sub: expect.anything(),},),
		)
	})

	it('coalesces concurrent first touches into a single bootstrap', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)
		isModSub.mockResolvedValue(true,)
		let releaseMigration!: () => void
		migrateSubredditToNxg.mockImplementation(() =>
			new Promise((resolve,) => {
				releaseMigration = () => resolve({copied: ['toolbox-nxg',], skipped: [], failed: [],},)
			},)
		)

		const first = resolveWikiLayout('sub',)
		const second = resolveWikiLayout('sub',)
		await new Promise((resolve,) => setTimeout(resolve, 0,))
		releaseMigration()

		const [firstLayout, secondLayout,] = await Promise.all([first, second,],)
		expect(migrateSubredditToNxg,).toHaveBeenCalledTimes(1,)
		expect(firstLayout,).toEqual(secondLayout,)
	})

	it('does not auto-migrate tombstoned subs with missing NXG pages', async () => {
		mockWikiPages({toolbox: {'Toolbox.Utils.wikiLayout': 'nxg',},},)
		isModSub.mockResolvedValue(true,)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'nxg', nxgMissing: true,},)
		expect(migrateSubredditToNxg,).not.toHaveBeenCalled()
		expect(bootstrapFreshSub,).not.toHaveBeenCalled()
	})

	it('flags externally deleted NXG pages instead of falling back to legacy reads', async () => {
		mockWikiPages({toolbox: {'Toolbox.Utils.wikiLayout': 'nxg',},},)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'nxg', nxgMissing: true,},)
		expect(negativeTextFeedback,).toHaveBeenCalled()
		// Reads and writes stay on NXG paths so a save/repair can recreate them.
		expect(await getWikiReadPath('settings', 'sub',),).toBe('toolbox-nxg',)
		expect(await getWikiWritePaths('settings', 'sub',),).toEqual(['toolbox-nxg',],)
	})

	it('peeks missing NXG pages silently (the settings UI shows the state in-place)', async () => {
		mockWikiPages({toolbox: {'Toolbox.Utils.wikiLayout': 'nxg',},},)

		const layout = await peekWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'nxg', nxgMissing: true,},)
		expect(negativeTextFeedback,).not.toHaveBeenCalled()
	})

	it('uses the persistent cache without reading the wiki', async () => {
		const cached = {subreddit: 'sub', state: 'nxg', compatibilityWrites: false,}
		getCache.mockImplementation((_moduleId: unknown, key: unknown, defaultVal: unknown,) =>
			Promise.resolve(key === 'wikiLayoutCache' ? {sub: cached,} : defaultVal,)
		)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toEqual(cached,)
		expect(readFromWiki,).not.toHaveBeenCalled()
	})

	it('caches resolutions for the session, including legacy states', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)

		await resolveWikiLayout('sub',)
		const readsAfterFirst = readFromWiki.mock.calls.length
		await resolveWikiLayout('sub',)

		expect(readFromWiki.mock.calls.length,).toBe(readsAfterFirst,)
	})

	it('peeks migrated subs identically to a full resolution, including caching', async () => {
		mockWikiPages({'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': true,},},)

		const peeked = await peekWikiLayout('sub',)

		expect(peeked,).toMatchObject({state: 'nxg', compatibilityWrites: true,},)
		expect(setCache,).toHaveBeenCalledWith('utils', 'wikiLayoutCache', {sub: peeked,},)
		// Session-cached: no further reads on resolve.
		readFromWiki.mockClear()
		await resolveWikiLayout('sub',)
		expect(readFromWiki,).not.toHaveBeenCalled()
	})

	it('exposes known layouts through getCachedWikiLayouts', async () => {
		mockWikiPages({'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': false,},},)
		await resolveWikiLayout('sub',)

		const known = await getCachedWikiLayouts()

		expect(known['sub'],).toMatchObject({state: 'nxg', compatibilityWrites: false,},)
	})

	it('treats a transient NXG read failure conservatively without migrating', async () => {
		readFromWiki.mockImplementation((_sub: string, page: string,) =>
			Promise.resolve(
				page === 'toolbox-nxg'
					? {ok: false, reason: 'unknown_error',}
					: {ok: true, data: {domainTags: [],},},
			)
		)

		const layout = await resolveWikiLayout('sub',)

		expect(layout,).toMatchObject({state: 'legacyFallback', fallbackReason: 'resolveError',},)
		expect(setCache,).not.toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			expect.objectContaining({sub: expect.anything(),},),
		)
	})
})

describe('path helpers', () => {
	it('reads NXG paths and fans writes out NXG-first for compat-on subs', async () => {
		mockWikiPages({'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': true,},},)

		expect(await getWikiReadPath('settings', 'sub',),).toBe('toolbox-nxg',)
		expect(await getWikiReadPath('usernotes', 'sub',),).toBe('toolbox-nxg/usernotes',)
		expect(await getWikiReadPath('notes', 'sub',),).toBe('toolbox-nxg/notes',)
		expect(await getWikiReadPath('userSettings', 'sub',),).toBe('toolbox-nxg/user-settings',)
		expect(await getWikiWritePaths('usernotes', 'sub',),).toEqual(['toolbox-nxg/usernotes', 'usernotes',],)
		expect(await getNotePagePrefix('sub',),).toBe('toolbox-nxg/notes/',)
		expect(await getNoteReadPath('my-note', 'sub',),).toBe('toolbox-nxg/notes/my-note',)
		expect(await getNoteWritePaths('my-note', 'sub',),).toEqual(
			['toolbox-nxg/notes/my-note', 'notes/my-note',],
		)
	})

	it('returns NXG paths only for compat-off subs', async () => {
		mockWikiPages({'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': false,},},)

		expect(await getWikiReadPath('settings', 'sub',),).toBe('toolbox-nxg',)
		expect(await getWikiReadPath('userSettings', 'sub',),).toBe('toolbox-nxg/user-settings',)
		expect(await getWikiWritePaths('settings', 'sub',),).toEqual(['toolbox-nxg',],)
		expect(await getNotePagePrefix('sub',),).toBe('toolbox-nxg/notes/',)
		expect(await getNoteReadPath('my-note', 'sub',),).toBe('toolbox-nxg/notes/my-note',)
		expect(await getNoteWritePaths('my-note', 'sub',),).toEqual(['toolbox-nxg/notes/my-note',],)
	})

	it('returns NXG paths for subs with no toolbox data', async () => {
		mockWikiPages({},)

		expect(await getWikiReadPath('settings', 'sub',),).toBe('toolbox-nxg',)
		expect(await getWikiWritePaths('settings', 'sub',),).toEqual(['toolbox-nxg',],)
	})

	it('returns legacy paths for legacyFallback subs', async () => {
		// A moderated legacy sub now migrates to NXG, so reach legacyFallback via the
		// transient-NXG-read-failure path (which keeps reads/writes on the legacy pages).
		readFromWiki.mockImplementation((_sub: string, page: string,) =>
			Promise.resolve(
				page === 'toolbox-nxg'
					? {ok: false, reason: 'unknown_error',}
					: {ok: true, data: {domainTags: [],},},
			)
		)

		expect(await getWikiReadPath('settings', 'sub',),).toBe('toolbox',)
		expect(await getWikiWritePaths('settings', 'sub',),).toEqual(['toolbox',],)
		expect(await getNoteWritePaths('my-note', 'sub',),).toEqual(['notes/my-note',],)
	})
})
