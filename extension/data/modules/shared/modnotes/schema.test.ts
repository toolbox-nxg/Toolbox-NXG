/** Tests for the mod notes schema lookup tables. */

import {describe, expect, it,} from 'vitest'

import {defaultUsernoteTypes,} from '../../../util/wiki/schemas/usernotes/schema'
import {labelNames, labelTypeToUsernoteType, usernoteTypeToLabelType,} from './schema'

describe('usernoteTypeToLabelType', () => {
	it('maps every built-in Toolbox note type to a real Reddit label', () => {
		for (const type of defaultUsernoteTypes) {
			const label = usernoteTypeToLabelType[type.key]
			expect(label, `no Reddit label for built-in type "${type.key}"`,).toBeDefined()
			expect(labelNames,).toHaveProperty(label!,)
		}
	})

	it('maps the ban types onto their matching Reddit severities', () => {
		expect(usernoteTypeToLabelType['ban'],).toBe('BAN',)
		expect(usernoteTypeToLabelType['permban'],).toBe('PERMA_BAN',)
		expect(usernoteTypeToLabelType['botban'],).toBe('BOT_BAN',)
	})

	it('leaves a subreddit\'s custom type unmapped, so the note saves unlabelled', () => {
		expect(usernoteTypeToLabelType['sockpuppet'],).toBeUndefined()
	})
})

describe('labelTypeToUsernoteType', () => {
	it('round-trips every mapped type, so switching a note\'s destination twice is lossless', () => {
		for (const [type, label,] of Object.entries(usernoteTypeToLabelType,)) {
			expect(labelTypeToUsernoteType[label!], `no return path for "${label}"`,).toBe(type,)
		}
	})

	it('leaves Reddit\'s auto-generated summary label with no Toolbox counterpart', () => {
		expect(labelTypeToUsernoteType['USER_SUMMARY'],).toBeUndefined()
	})
})
