/** Tests for the subreddit-notes index codec. */

import {describe, expect, it,} from 'vitest'

import {
	buildIndexFromWikiPages,
	computeIndexAggregates,
	encodeLegacyIndex,
	mergeLegacyIndex,
	normalizeIndex,
} from './codec'

describe('subreddit notes index codec', () => {
	it('bootstraps a stable index from legacy wiki pages', () => {
		expect(buildIndexFromWikiPages(
			[
				'config/toolbox',
				'notes/zebra-note',
				'notes/index',
				'notes/alpha-note',
				'notes/alpha-note',
			],
			'notes/',
			1000,
		),).toEqual({
			version: 2,
			notes: [
				{slug: 'alpha-note', title: 'Alpha Note', createdAt: 1000, updatedAt: 1000, archived: false, tags: [],},
				{slug: 'zebra-note', title: 'Zebra Note', createdAt: 1000, updatedAt: 1000, archived: false, tags: [],},
			],
			tags: [],
			authors: [],
		},)
	})

	it('bootstraps an index from NXG wiki pages using the NXG prefix', () => {
		expect(buildIndexFromWikiPages(
			[
				'toolbox-nxg',
				'toolbox-nxg/notes',
				'toolbox-nxg/notes/some-note',
				'notes/legacy-note',
			],
			'toolbox-nxg/notes/',
			1000,
		),).toEqual({
			version: 2,
			notes: [
				{slug: 'some-note', title: 'Some Note', createdAt: 1000, updatedAt: 1000, archived: false, tags: [],},
			],
			tags: [],
			authors: [],
		},)
	})

	it('normalizes valid index data and rejects invalid shapes', () => {
		expect(normalizeIndex({notes: 'nope',},),).toBeNull()
		expect(normalizeIndex({
			version: 99,
			notes: [
				{
					slug: 'one',
					title: ' One ',
					createdAt: 5,
					updatedAt: 10,
					archived: true,
					tags: ['ops',],
					author: 'mod1',
				},
				{slug: 'one', title: 'Duplicate',},
				{slug: 'index', title: 'Index',},
				{slug: 'two',},
			],
		}, 50,),).toEqual({
			version: 2,
			notes: [
				{
					slug: 'one',
					title: 'One',
					createdAt: 5,
					updatedAt: 10,
					archived: true,
					tags: ['ops',],
					author: 'mod1',
				},
				{slug: 'two', title: 'Two', createdAt: 50, updatedAt: 50, archived: false, tags: [],},
			],
			tags: ['ops',],
			authors: ['mod1',],
		},)
	})

	it('recomputes aggregates from sorted unique tags and authors', () => {
		const notes = [
			{
				slug: 'a',
				title: 'A',
				createdAt: 0,
				updatedAt: 0,
				archived: false,
				tags: ['Queue', 'ops',],
				author: 'zed',
			},
			{slug: 'b', title: 'B', createdAt: 0, updatedAt: 0, archived: false, tags: ['ops',], author: 'Amy',},
			{slug: 'c', title: 'C', createdAt: 0, updatedAt: 0, archived: false, tags: [],},
		]

		expect(computeIndexAggregates(notes,),).toEqual({
			tags: ['ops', 'Queue',],
			authors: ['Amy', 'zed',],
		},)
		expect(computeIndexAggregates([],),).toEqual({tags: [], authors: [],},)
	})

	it('down-converts an index to the legacy v1 wire shape', () => {
		const notes = [
			{slug: 'a', title: 'A', createdAt: 0, updatedAt: 0, archived: false, tags: ['ops',], author: 'amy',},
		]

		expect(encodeLegacyIndex({notes,},),).toEqual({version: 1, notes,},)
	})

	describe('mergeLegacyIndex', () => {
		const note = (slug: string, extra: Record<string, unknown> = {},) => ({
			slug,
			title: slug,
			createdAt: 1,
			updatedAt: 2,
			archived: false,
			tags: [],
			...extra,
		})

		it('appends slugs that only exist on the legacy side', () => {
			const nxg = normalizeIndex({version: 2, notes: [note('alpha',),],},)!
			const legacy = normalizeIndex({version: 1, notes: [note('alpha',), note('from-six',),],},)!

			const merged = mergeLegacyIndex(nxg, legacy,)

			expect(merged.changed,).toBe(true,)
			expect(merged.index.notes.map((n,) => n.slug),).toEqual(['alpha', 'from-six',],)
		})

		it('keeps NXG-only slugs (legacy deletions never propagate)', () => {
			const nxg = normalizeIndex({version: 2, notes: [note('alpha',), note('nxg-only',),],},)!
			const legacy = normalizeIndex({version: 1, notes: [note('alpha',),],},)!

			const merged = mergeLegacyIndex(nxg, legacy,)

			expect(merged.changed,).toBe(false,)
			expect(merged.index,).toBe(nxg,)
		})

		it('prefers the NXG entry metadata for slugs on both sides and recomputes aggregates', () => {
			const nxg = normalizeIndex(
				{version: 2, notes: [note('alpha', {tags: ['kept',], author: 'nxgmod',},),],},
			)!
			const legacy = normalizeIndex(
				{version: 1, notes: [note('alpha', {tags: ['stale',],},), note('extra', {author: 'sixmod',},),],},
			)!

			const merged = mergeLegacyIndex(nxg, legacy,)

			expect(merged.changed,).toBe(true,)
			const alpha = merged.index.notes.find((n,) => n.slug === 'alpha')!
			expect(alpha.tags,).toEqual(['kept',],)
			expect(merged.index.tags,).toEqual(['kept',],)
			expect(merged.index.authors,).toEqual(['nxgmod', 'sixmod',],)
		})
	})
})
