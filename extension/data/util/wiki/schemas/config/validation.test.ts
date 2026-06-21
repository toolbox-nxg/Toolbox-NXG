/** Tests for the raw wiki editor JSON validator. */

import {describe, expect, it,} from 'vitest'

import {validateWikiEditorJson,} from './validation'

describe('validateWikiEditorJson', () => {
	it('returns nothing for blank text', () => {
		expect(validateWikiEditorJson('', 'toolbox',),).toEqual([],)
		expect(validateWikiEditorJson('   \n', 'usernotes',),).toEqual([],)
	})

	it('flags syntax errors as blocking errors with a line number', () => {
		const diagnostics = validateWikiEditorJson('{\n    "ver": 2,\n}', 'toolbox',)

		expect(diagnostics,).toHaveLength(1,)
		expect(diagnostics[0]!.severity,).toBe('error',)
		expect(diagnostics[0]!.message,).toContain('line 3',)
		expect(diagnostics[0]!.from,).toBe(16,)
	})

	it('accepts a well-formed v2 toolbox config', () => {
		const config = {
			ver: 2,
			removalReasons: {reasons: [{id: 'abc', text: 'hello', title: 't',},], header: 'h',},
			modMacros: [{id: 'def', text: 'macro',},],
			usernoteColors: [{key: 'k', text: 'T', color: '#fff',},],
			domainTags: [{name: 'example.com', color: '#000',},],
			banMacros: null,
		}
		expect(validateWikiEditorJson(JSON.stringify(config, null, 4,), 'toolbox',),).toEqual([],)
	})

	it('warns about wrong field types in the toolbox config, pointing at the value', () => {
		const text = JSON.stringify(
			{
				ver: 'two',
				removalReasons: {reasons: [{text: 5,},],},
				modMacros: 'nope',
			},
			null,
			4,
		)

		const diagnostics = validateWikiEditorJson(text, 'toolbox',)

		const messages = diagnostics.map((d,) => d.message)
		expect(messages,).toContain('ver should be a number',)
		expect(messages,).toContain('reason #1 text should be a string',)
		expect(messages,).toContain('modMacros should be an array',)
		expect(diagnostics.every((d,) => d.severity === 'warning'),).toBe(true,)
		// The ver diagnostic highlights the offending value, not the whole page.
		const verDiagnostic = diagnostics.find((d,) => d.message.startsWith('ver',))!
		expect(text.slice(verDiagnostic.from, verDiagnostic.to,),).toBe('"two"',)
	})

	it('accepts a reason with an inline {choice} block', () => {
		const config = {
			ver: 2,
			removalReasons: {
				reasons: [{
					id: 'abc',
					text: 'Which rule?\n\n{choice#rule}\n- a\n- b',
					title: 't',
				},],
			},
			modMacros: [],
			usernoteColors: [],
			domainTags: [],
			banMacros: null,
		}
		expect(validateWikiEditorJson(JSON.stringify(config, null, 4,), 'toolbox',),).toEqual([],)
	})

	it('warns when the page is not a JSON object', () => {
		const diagnostics = validateWikiEditorJson('[1, 2]', 'toolbox',)
		expect(diagnostics,).toHaveLength(1,)
		expect(diagnostics[0]!.message,).toContain('JSON object',)
	})

	it('accepts compressed and decompressed usernotes shapes', () => {
		expect(validateWikiEditorJson('{"ver": 6, "constants": {}, "blob": "abc"}', 'usernotes',),).toEqual([],)
		expect(validateWikiEditorJson('{"ver": 6, "constants": {}, "users": {}}', 'usernotes',),).toEqual([],)
	})

	it('warns about missing or unsupported usernotes versions', () => {
		expect(validateWikiEditorJson('{"users": {}}', 'usernotes',)[0]!.message,).toContain('numeric ver',)
		expect(validateWikiEditorJson('{"ver": 5}', 'usernotes',)[0]!.message,).toContain('unsupported',)
		expect(validateWikiEditorJson('{"ver": 7, "users": {}}', 'usernotes',)[0]!.message,).toContain('unsupported',)
	})

	it('warns when v6 usernotes have neither blob nor users', () => {
		const diagnostics = validateWikiEditorJson('{"ver": 6, "constants": {}}', 'usernotes',)
		expect(diagnostics.map((d,) => d.message),).toContain(
			'v6 usernotes need either a blob string or a users object',
		)
	})

	it('accepts a v7 shard manifest on the usernotes page', () => {
		const manifest = {
			format: 'tbun-manifest',
			ver: 7,
			gen: 1,
			types: [],
			shards: [{start: 0, page: 's1-00000000',},],
		}
		expect(validateWikiEditorJson(JSON.stringify(manifest, null, 4,), 'usernotes',),).toEqual([],)
	})

	it('warns about wrong manifest versions and missing shards', () => {
		expect(
			validateWikiEditorJson('{"format": "tbun-manifest", "ver": 1, "shards": []}', 'usernotes',)[0]!.message,
		).toContain('unsupported manifest schema version 1',)
		expect(
			validateWikiEditorJson('{"format": "tbun-manifest", "ver": 7, "gen": 1}', 'usernotes',)
				.map((d,) => d.message),
		).toContain('the manifest needs a shards array',)
	})

	it('accepts compressed and decompressed usernotes shard shapes', () => {
		expect(
			validateWikiEditorJson('{"format": "nxg-usernotes", "ver": 1, "blob": "abc"}', 'usernotesShard',),
		).toEqual([],)
		expect(
			validateWikiEditorJson('{"format": "nxg-usernotes", "ver": 1, "users": {}}', 'usernotesShard',),
		).toEqual([],)
	})

	it('warns about wrong shard format markers and versions', () => {
		expect(validateWikiEditorJson('{"ver": 1, "blob": "abc"}', 'usernotesShard',)[0]!.message,)
			.toContain('format',)
		expect(
			validateWikiEditorJson('{"format": "nxg-usernotes", "ver": 2, "blob": "abc"}', 'usernotesShard',)[0]!
				.message,
		).toContain('unsupported',)
	})

	it('warns when a shard page has neither blob nor users', () => {
		const diagnostics = validateWikiEditorJson('{"format": "nxg-usernotes", "ver": 1}', 'usernotesShard',)
		expect(diagnostics.map((d,) => d.message),).toContain(
			'shard pages need either a blob string or a users object',
		)
	})
})
