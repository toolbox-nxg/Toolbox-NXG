/** Tests for the classic (schema v1) config down-convert codec. */

import {describe, expect, it,} from 'vitest'

import {encodeClassicConfig,} from './codec'
import type {ToolboxConfig,} from './schema'

/** Builds a minimal normalized v2 config with the given overrides. */
function v2Config (overrides: Partial<ToolboxConfig> = {},): ToolboxConfig {
	return {
		ver: 2,
		removalReasons: {reasons: [],},
		modMacros: [],
		banMacros: null,
		...overrides,
	}
}

describe('encodeClassicConfig', () => {
	it('writes ver 1 and leaves the input unmodified', () => {
		const config = v2Config({
			removalReasons: {
				reasons: [{
					id: 'abc12345',
					text: 'plain',
					title: 't',
					flairText: '',
					flairCSS: '',
					flairTemplateID: '',
				},],
			},
		},)

		const classic = encodeClassicConfig(config,)

		expect(classic.ver,).toBe(1,)
		expect(config.ver,).toBe(2,)
		expect(config.removalReasons.reasons[0]!.id,).toBe('abc12345',)
	})

	it('escape()-encodes reason text, header, footer, and macro text', () => {
		const config = v2Config({
			removalReasons: {
				reasons: [
					{text: 'no spam, 100% sure — ok', title: '', flairText: '', flairCSS: '', flairTemplateID: '',},
				],
				header: 'hello there',
				footer: '*bye*',
			},
			modMacros: [{text: 'macro text +1',},],
		},)

		const classic = encodeClassicConfig(config,)

		// eslint-disable-next-line no-restricted-globals
		expect(unescape(classic.removalReasons.reasons[0].text,),).toBe('no spam, 100% sure — ok',)
		expect(classic.removalReasons.header,).toBe('hello%20there',)
		expect(classic.removalReasons.footer,).toBe('*bye*',)
		expect(classic.modMacros[0].text,).toBe('macro%20text%20+1',)
	})

	it('down-converts interactive tokens to the legacy HTML form', () => {
		const config = v2Config({
			removalReasons: {
				reasons: [{
					text: 'Pick {select:rule} and explain {input: why}',
					selects: [{name: 'rule', options: ['Rule 1', 'Rule 2',],},],
					title: '',
					flairText: '',
					flairCSS: '',
					flairTemplateID: '',
				},],
			},
		},)

		const classic = encodeClassicConfig(config,)

		// eslint-disable-next-line no-restricted-globals
		expect(unescape(classic.removalReasons.reasons[0].text,),).toBe(
			'Pick <select id="rule"><option>Rule 1</option><option>Rule 2</option></select> '
				+ 'and explain <input placeholder="why">',
		)
		// The structured definitions are an NXG-only shape; the mirror carries
		// only the expanded HTML.
		expect(classic.removalReasons.reasons[0],).not.toHaveProperty('selects',)
		expect(config.removalReasons.reasons[0]!.selects,).toHaveLength(1,)
	})

	it('strips stable ids and NXG layout metadata', () => {
		const config = v2Config({
			removalReasons: {
				reasons: [{id: 'r1', text: '', title: '', flairText: '', flairCSS: '', flairTemplateID: '',},],
			},
			modMacros: [{id: 'm1', text: 'x',},],
		},)
		;(config as any)['Toolbox.Utils.compatibilityWrites'] = true

		const classic = encodeClassicConfig(config,)

		expect(classic.removalReasons.reasons[0],).not.toHaveProperty('id',)
		expect(classic.modMacros[0],).not.toHaveProperty('id',)
		expect(classic,).not.toHaveProperty('Toolbox.Utils.compatibilityWrites',)
	})

	it('tolerates partial config objects without throwing', () => {
		expect(encodeClassicConfig({foo: 'bar',} as any,),).toEqual({foo: 'bar', ver: 1,},)
	})

	it('strips NXG-only usernote save-requirement fields from the legacy mirror', () => {
		const classic = encodeClassicConfig(v2Config({
			requireUsernoteType: true,
			requireUsernoteText: false,
			requireUsernoteLink: true,
			usernoteRequirementOption: 'require',
		},),)

		expect(classic,).not.toHaveProperty('requireUsernoteType',)
		expect(classic,).not.toHaveProperty('requireUsernoteText',)
		expect(classic,).not.toHaveProperty('requireUsernoteLink',)
		expect(classic,).not.toHaveProperty('usernoteRequirementOption',)
	})

	it('strips NXG-only training-mode fields from the legacy mirror', () => {
		const classic = encodeClassicConfig(v2Config({
			trainingMods: ['rookie',],
			guardedActions: ['remove', 'ban',],
			proposalRetentionDays: 30,
		},),)

		expect(classic,).not.toHaveProperty('trainingMods',)
		expect(classic,).not.toHaveProperty('guardedActions',)
		expect(classic,).not.toHaveProperty('proposalRetentionDays',)
	})

	it('re-injects domain tags in the legacy v1 shape, dropping NXG-only counters', () => {
		const classic = encodeClassicConfig(
			v2Config(),
			[
				{
					name: 'i.imgur.com',
					color: '#ff0000',
					note: 'flag',
					approvalCount: 3,
					removalCount: 7,
					removalThreshold: 50,
				},
				{name: '*.blogspot.com', color: 'none', approvalCount: 0, removalCount: 0,},
			],
			undefined,
		)

		expect(classic.domainTags,).toEqual([
			{name: 'i.imgur.com', color: '#ff0000', note: 'flag',},
			{name: '*.blogspot.com', color: 'none', note: undefined,},
		],)
	})

	it('re-injects usernote colors in the legacy v1 shape, dropping NXG-only fields', () => {
		const classic = encodeClassicConfig(
			v2Config(),
			undefined,
			[
				{
					key: 'spamwatch',
					text: 'Spam Watch',
					color: 'black',
					colorDark: '#222',
					banDuration: 7,
					autoArchiveDays: 90,
				},
			],
		)

		expect(classic.usernoteColors,).toEqual([
			{key: 'spamwatch', text: 'Spam Watch', color: 'black',},
		],)
	})

	it('omits the fields when no domain tags or usernote colors are passed', () => {
		const fromUndefined = encodeClassicConfig(v2Config(),)
		expect(fromUndefined,).not.toHaveProperty('domainTags',)
		expect(fromUndefined,).not.toHaveProperty('usernoteColors',)

		// Empty arrays carry nothing for 6.x, so they stay off the mirror too.
		const fromEmpty = encodeClassicConfig(v2Config(), [], [],)
		expect(fromEmpty,).not.toHaveProperty('domainTags',)
		expect(fromEmpty,).not.toHaveProperty('usernoteColors',)
	})
})
