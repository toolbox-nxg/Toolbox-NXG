/** Tests for the usernote save-requirement resolution rule. */

// @vitest-environment node
import {describe, expect, it,} from 'vitest'

import {resolveUsernoteRequirements, subUsernoteRequireFromConfig, unmetUsernoteRequirement,} from './requireRules'

/** All-false personal flags, the typical "moderator opted into nothing" case. */
const noPersonal = {type: false, text: false, link: false,}

describe('resolveUsernoteRequirements', () => {
	it('defers to personal flags when the mode is leave or unset', () => {
		const sub = {type: true, text: true, link: true, mode: undefined,}
		expect(resolveUsernoteRequirements(sub, noPersonal,),).toEqual(noPersonal,)
		expect(resolveUsernoteRequirements({...sub, mode: 'leave',}, noPersonal,),).toEqual(noPersonal,)
	})

	it('defers to personal flags for an unrecognized mode (e.g. the old "require")', () => {
		const sub = {type: true, text: true, link: true, mode: 'require',}
		expect(resolveUsernoteRequirements(sub, noPersonal,),).toEqual(noPersonal,)
	})

	it('keeps a moderator\'s stricter personal flags even when the mode is leave', () => {
		const sub = {type: false, text: false, link: false, mode: 'leave',}
		const personal = {type: true, text: false, link: true,}
		expect(resolveUsernoteRequirements(sub, personal,),).toEqual(personal,)
	})

	it('treats the subreddit flags as a floor under suggest', () => {
		const sub = {type: true, text: false, link: true, mode: 'suggest',}
		expect(resolveUsernoteRequirements(sub, noPersonal,),).toEqual({type: true, text: false, link: true,},)
	})

	it('treats the subreddit flags as a floor under force', () => {
		const sub = {type: false, text: true, link: false, mode: 'force',}
		expect(resolveUsernoteRequirements(sub, noPersonal,),).toEqual({type: false, text: true, link: false,},)
	})

	it('unions the subreddit and personal flags (more restrictive wins)', () => {
		const sub = {type: true, text: false, link: false, mode: 'force',}
		const personal = {type: false, text: false, link: true,}
		expect(resolveUsernoteRequirements(sub, personal,),).toEqual({type: true, text: false, link: true,},)
	})

	it('never lets a moderator drop below the subreddit floor', () => {
		const sub = {type: true, text: true, link: true, mode: 'force',}
		expect(resolveUsernoteRequirements(sub, noPersonal,),).toEqual({type: true, text: true, link: true,},)
	})
})

describe('subUsernoteRequireFromConfig', () => {
	it('applies per-field defaults for an absent config', () => {
		expect(subUsernoteRequireFromConfig(undefined,),).toEqual({
			type: false,
			text: true,
			link: false,
			mode: undefined,
		},)
	})

	it('reads explicit flags and the mode through verbatim', () => {
		expect(
			subUsernoteRequireFromConfig({
				requireUsernoteType: true,
				requireUsernoteText: false,
				requireUsernoteLink: true,
				usernoteRequirementOption: 'force',
			},),
		).toEqual({type: true, text: false, link: true, mode: 'force',},)
	})

	it('only an explicit false disables the text requirement', () => {
		expect(subUsernoteRequireFromConfig({},).text,).toBe(true,)
		expect(subUsernoteRequireFromConfig({requireUsernoteText: false,},).text,).toBe(false,)
	})
})

describe('unmetUsernoteRequirement', () => {
	const fullDraft = {hasText: true, hasType: true, hasLink: true, linkEnforceable: true,}
	const noRequire = {type: false, text: false, link: false,}

	it('returns null when nothing is required', () => {
		expect(unmetUsernoteRequirement(noRequire, {...fullDraft, hasText: false, hasType: false,},),).toBeNull()
	})

	it('flags missing text first', () => {
		expect(
			unmetUsernoteRequirement({type: true, text: true, link: true,}, {...fullDraft, hasText: false,},),
		).toContain('text',)
	})

	it('flags a missing type', () => {
		expect(
			unmetUsernoteRequirement({type: true, text: false, link: false,}, {...fullDraft, hasType: false,},),
		).toContain('type',)
	})

	it('flags a missing link only when the link is enforceable', () => {
		expect(
			unmetUsernoteRequirement({type: false, text: false, link: true,}, {...fullDraft, hasLink: false,},),
		).toContain('link',)
		// Edit mode / no-link contexts can't attach a link, so it isn't enforced.
		expect(
			unmetUsernoteRequirement(
				{type: false, text: false, link: true,},
				{...fullDraft, hasLink: false, linkEnforceable: false,},
			),
		).toBeNull()
	})
})
