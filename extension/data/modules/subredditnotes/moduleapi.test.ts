/** Tests for the subreddit notes wiki storage operations, especially legacy↔NXG reconciliation. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readFromWiki = vi.hoisted(() => vi.fn())
const postToWiki = vi.hoisted(() => vi.fn())
const getWikiPages = vi.hoisted(() => vi.fn())
const getWikiRevisions = vi.hoisted(() => vi.fn())
const resolveWikiLayout = vi.hoisted(() => vi.fn())

vi.mock('../../api/resources/wiki', () => ({readFromWiki, postToWiki, getWikiPages, getWikiRevisions,}),)
vi.mock('../../util/wiki/wikiPaths', () => ({
	resolveWikiLayout,
	compatMirrorEnabled: (layout: {state: string; compatibilityWrites: boolean; nxgMissing?: boolean},) =>
		layout.state === 'nxg' && layout.compatibilityWrites && !layout.nxgMissing,
	getWikiWritePaths: vi.fn().mockResolvedValue(['toolbox-nxg/notes',],),
	getNoteWritePaths: vi.fn(),
	OLD_NOTE_PAGE_PREFIX: 'notes/',
	NEW_NOTE_PAGE_PREFIX: 'toolbox-nxg/notes/',
	OLD_WIKI_PATHS: {
		settings: 'toolbox',
		usernotes: 'usernotes',
		notes: 'notes/index',
		userSettings: 'tbsettings',
	},
	NEW_WIKI_PATHS: {
		settings: 'toolbox-nxg',
		usernotes: 'toolbox-nxg/usernotes',
		notes: 'toolbox-nxg/notes',
		userSettings: 'toolbox-nxg/user-settings',
	},
}),)

import {loadNoteIndex, readNotePage,} from './moduleapi'

/** Marks the mocked layout for the test sub. */
function mockLayout (state: 'legacyFallback' | 'nxg', compatibilityWrites = false,) {
	resolveWikiLayout.mockResolvedValue({subreddit: 'sub', state, compatibilityWrites,},)
}

/** Mocks readFromWiki per page; unlisted pages yield no_page. */
function mockWikiPagesContent (pages: Record<string, unknown>,) {
	readFromWiki.mockImplementation(async (_sub: string, page: string,) =>
		page in pages
			? {ok: true, data: pages[page],}
			: {ok: false, reason: 'no_page',}
	)
}

/** A minimal raw index whose notes carry the given slugs. */
function rawIndex (version: number, ...slugs: string[]) {
	return {
		version,
		notes: slugs.map((slug,) => ({slug, title: slug, createdAt: 1, updatedAt: 2, archived: false, tags: [],})),
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	getWikiPages.mockResolvedValue([],)
	postToWiki.mockResolvedValue(undefined,)
	getWikiRevisions.mockResolvedValue([],)
},)

describe('loadNoteIndex', () => {
	it('reads the legacy index for legacyFallback subs', async () => {
		mockLayout('legacyFallback',)
		mockWikiPagesContent({'notes/index': rawIndex(1, 'alpha',),},)

		const {index, bootstrapped,} = await loadNoteIndex('sub',)

		expect(index.notes.map((n,) => n.slug),).toEqual(['alpha',],)
		expect(bootstrapped,).toBe(false,)
		expect(readFromWiki,).toHaveBeenCalledWith('sub', 'notes/index', true,)
	})

	it('reads the NXG index only when compat is off', async () => {
		mockLayout('nxg', false,)
		mockWikiPagesContent({'toolbox-nxg/notes': rawIndex(2, 'alpha',),},)

		const {index, bootstrapped,} = await loadNoteIndex('sub',)

		expect(index.notes.map((n,) => n.slug),).toEqual(['alpha',],)
		expect(bootstrapped,).toBe(false,)
		expect(readFromWiki,).not.toHaveBeenCalledWith('sub', 'notes/index', true,)
	})

	it('compat-on: merges 6.x-created notes from the legacy index and flags for persist', async () => {
		mockLayout('nxg', true,)
		mockWikiPagesContent({
			'toolbox-nxg/notes': rawIndex(2, 'alpha',),
			'notes/index': rawIndex(1, 'alpha', 'from-six',),
		},)

		const {index, bootstrapped,} = await loadNoteIndex('sub',)

		expect(index.notes.map((n,) => n.slug),).toEqual(['alpha', 'from-six',],)
		// The merge marks the index for persisting, which heals the divergence.
		expect(bootstrapped,).toBe(true,)
	})

	it('compat-on: an agreeing legacy index changes nothing', async () => {
		mockLayout('nxg', true,)
		mockWikiPagesContent({
			'toolbox-nxg/notes': rawIndex(2, 'alpha',),
			'notes/index': rawIndex(1, 'alpha',),
		},)

		const {index, bootstrapped,} = await loadNoteIndex('sub',)

		expect(index.notes.map((n,) => n.slug),).toEqual(['alpha',],)
		expect(bootstrapped,).toBe(false,)
	})
})

describe('readNotePage', () => {
	it('reads the legacy page for legacyFallback subs', async () => {
		mockLayout('legacyFallback',)
		mockWikiPagesContent({'notes/alpha': 'legacy body',},)

		const result = await readNotePage('sub', 'alpha',)

		expect(result,).toEqual({ok: true, data: 'legacy body',},)
	})

	it('reads only the NXG page when compat is off', async () => {
		mockLayout('nxg', false,)
		mockWikiPagesContent({'toolbox-nxg/notes/alpha': 'nxg body',},)

		const result = await readNotePage('sub', 'alpha',)

		expect(result,).toEqual({ok: true, data: 'nxg body',},)
		expect(readFromWiki,).toHaveBeenCalledTimes(1,)
	})

	it('compat-on: identical content needs no revision lookups', async () => {
		mockLayout('nxg', true,)
		mockWikiPagesContent({
			'toolbox-nxg/notes/alpha': 'same body',
			'notes/alpha': 'same body',
		},)

		const result = await readNotePage('sub', 'alpha',)

		expect(result,).toEqual({ok: true, data: 'same body',},)
		expect(getWikiRevisions,).not.toHaveBeenCalled()
	})

	it('compat-on: serves the legacy body for 6.x-created notes missing on the NXG side', async () => {
		mockLayout('nxg', true,)
		mockWikiPagesContent({'notes/alpha': 'six body',},)

		const result = await readNotePage('sub', 'alpha',)

		expect(result,).toEqual({ok: true, data: 'six body',},)
	})

	it('compat-on: a newer legacy revision wins and is copied to the NXG page', async () => {
		mockLayout('nxg', true,)
		mockWikiPagesContent({
			'toolbox-nxg/notes/alpha': 'old nxg body',
			'notes/alpha': 'edited in 6.x',
		},)
		getWikiRevisions.mockImplementation(async (_sub: string, page: string,) =>
			page === 'notes/alpha'
				? [{id: 'r2', timestamp: 200, author: 'sixmod', reason: '',},]
				: [{id: 'r1', timestamp: 100, author: 'nxgmod', reason: '',},]
		)

		const result = await readNotePage('sub', 'alpha',)

		expect(result,).toEqual({ok: true, data: 'edited in 6.x',},)
		expect(postToWiki,).toHaveBeenCalledWith(
			'sub',
			'toolbox-nxg/notes/alpha',
			'edited in 6.x',
			'Adopting 6.x note edit',
			false,
			false,
		)
	})

	it('compat-on: a newer NXG revision wins (failed mirror is not rolled back)', async () => {
		mockLayout('nxg', true,)
		mockWikiPagesContent({
			'toolbox-nxg/notes/alpha': 'newer nxg body',
			'notes/alpha': 'stale mirror body',
		},)
		getWikiRevisions.mockImplementation(async (_sub: string, page: string,) =>
			page === 'notes/alpha'
				? [{id: 'r1', timestamp: 100, author: 'nxgmod', reason: '',},]
				: [{id: 'r2', timestamp: 200, author: 'nxgmod', reason: '',},]
		)

		const result = await readNotePage('sub', 'alpha',)

		expect(result,).toEqual({ok: true, data: 'newer nxg body',},)
		expect(postToWiki,).not.toHaveBeenCalled()
	})
})
