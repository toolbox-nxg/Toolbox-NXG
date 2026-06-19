/** Tests for subreddit notes UI helpers. */

import {describe, expect, it,} from 'vitest'

import {
	filterAndSortNotes,
	getAllAuthors,
	getAllTags,
	makeTimestampUserSlug,
	makeUniqueSlug,
	shouldWarnUnsaved,
} from './helpers'

describe('subreddit notes helpers', () => {
	it('generates unique slugs with collision suffixes', () => {
		expect(makeUniqueSlug('My Note', ['my_note', 'my_note-2',],),).toBe('my_note-3',)
		expect(makeUniqueSlug('', [],),).toBe('note',)
		expect(makeUniqueSlug('Index', ['index',],),).toBe('index-2',)
		expect(makeTimestampUserSlug(1_780_000_000_000, 'Test_Mod', [],),).toBe('1780000000-test_mod',)
		expect(makeTimestampUserSlug(1_780_000_000_000, 'Test_Mod', ['1780000000-test_mod',],),)
			.toBe('1780000000-test_mod-2',)
	})

	it('filters archived notes and sorts by title or update time', () => {
		const notes = [
			{slug: 'b', title: 'Beta', createdAt: 0, updatedAt: 10, archived: false, tags: ['queue',],},
			{slug: 'a', title: 'Alpha', createdAt: 0, updatedAt: 30, archived: true, tags: [],},
			{slug: 'c', title: 'Gamma', createdAt: 0, updatedAt: 20, archived: false, tags: [],},
		]

		expect(filterAndSortNotes(notes, {search: '', showArchived: false, sort: 'title',},).map((note,) => note.slug),)
			.toEqual(['b', 'c',],)
		expect(
			filterAndSortNotes(notes, {search: 'alp', showArchived: true, sort: 'updated',},).map((note,) => note.slug),
		)
			.toEqual(['a',],)
		expect(
			filterAndSortNotes(notes, {search: 'queue', showArchived: false, sort: 'title',},).map((note,) =>
				note.slug
			),
		)
			.toEqual(['b',],)
	})

	it('filters notes to those containing all selected tags', () => {
		const notes = [
			{slug: 'a', title: 'A', createdAt: 0, updatedAt: 0, archived: false, tags: ['ops', 'queue',],},
			{slug: 'b', title: 'B', createdAt: 0, updatedAt: 0, archived: false, tags: ['ops',],},
			{slug: 'c', title: 'C', createdAt: 0, updatedAt: 0, archived: false, tags: ['queue',],},
		]
		expect(
			filterAndSortNotes(notes, {search: '', showArchived: false, sort: 'title', selectedTags: ['ops',],},)
				.map((n,) => n.slug),
		).toEqual(['a', 'b',],)
		expect(
			filterAndSortNotes(notes, {
				search: '',
				showArchived: false,
				sort: 'title',
				selectedTags: ['ops', 'queue',],
			},)
				.map((n,) => n.slug),
		).toEqual(['a',],)
	})

	it('filters notes to those by selected authors', () => {
		const notes = [
			{slug: 'a', title: 'A', createdAt: 0, updatedAt: 0, archived: false, tags: [], author: 'alice',},
			{slug: 'b', title: 'B', createdAt: 0, updatedAt: 0, archived: false, tags: [], author: 'bob',},
			{slug: 'c', title: 'C', createdAt: 0, updatedAt: 0, archived: false, tags: [],},
		]
		expect(
			filterAndSortNotes(notes, {search: '', showArchived: false, sort: 'title', selectedAuthors: ['alice',],},)
				.map((n,) => n.slug),
		).toEqual(['a',],)
		expect(
			filterAndSortNotes(notes, {
				search: '',
				showArchived: false,
				sort: 'title',
				selectedAuthors: ['alice', 'bob',],
			},)
				.map((n,) => n.slug),
		).toEqual(['a', 'b',],)
		expect(
			filterAndSortNotes(notes, {search: '', showArchived: false, sort: 'title', selectedAuthors: [],},)
				.map((n,) => n.slug),
		).toEqual(['a', 'b', 'c',],)
	})

	it('tallies tag counts across notes sorted by frequency then name', () => {
		const notes = [
			{slug: 'a', title: 'A', createdAt: 0, updatedAt: 0, archived: false, tags: ['ops', 'queue',],},
			{slug: 'b', title: 'B', createdAt: 0, updatedAt: 0, archived: false, tags: ['ops',],},
			{slug: 'c', title: 'C', createdAt: 0, updatedAt: 0, archived: false, tags: ['zebra', 'ops',],},
		]
		expect(getAllTags(notes,),).toEqual([
			{tag: 'ops', count: 3,},
			{tag: 'queue', count: 1,},
			{tag: 'zebra', count: 1,},
		],)
	})

	it('getAllAuthors returns sorted unique authors, ignoring notes with no author', () => {
		const notes = [
			{slug: 'a', title: 'A', createdAt: 0, updatedAt: 0, archived: false, tags: [], author: 'mod2',},
			{slug: 'b', title: 'B', createdAt: 0, updatedAt: 0, archived: false, tags: [], author: 'mod1',},
			{slug: 'c', title: 'C', createdAt: 0, updatedAt: 0, archived: false, tags: [],},
			{slug: 'd', title: 'D', createdAt: 0, updatedAt: 0, archived: false, tags: [], author: 'mod2',},
		]
		expect(getAllAuthors(notes,),).toEqual(['mod1', 'mod2',],)
	})

	it('warns only for unsaved editable changes', () => {
		expect(shouldWarnUnsaved('same', 'same', false,),).toBe(false,)
		expect(shouldWarnUnsaved('old', 'new', false,),).toBe(true,)
		expect(shouldWarnUnsaved('old', 'new', true,),).toBe(false,)
	})
})
