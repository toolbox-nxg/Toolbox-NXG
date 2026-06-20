/** Tests for parseAutomodReasons. */

import {describe, expect, it,} from 'vitest'

import {parseAutomodReasons, staticReasonPart,} from './automodReasons'

describe('staticReasonPart', () => {
	it('returns a placeholder-free reason unchanged (trimmed)', () => {
		expect(staticReasonPart('  Meta post to be reviewed  ',),).toBe('Meta post to be reviewed',)
	})

	it('keeps the longest static run around a placeholder', () => {
		expect(staticReasonPart('Possible repost of {{match}}',),).toBe('Possible repost of',)
		expect(staticReasonPart('Repost of {{match}} detected here',),).toBe('detected here',)
		expect(staticReasonPart('{{author}} posted a meta thread',),).toBe('posted a meta thread',)
	})

	it('falls back to the trimmed original when the reason is only a placeholder', () => {
		expect(staticReasonPart('{{match}}',),).toBe('{{match}}',)
	})
})

describe('parseAutomodReasons', () => {
	it('returns [] for empty or reason-free config', () => {
		expect(parseAutomodReasons('',),).toEqual([],)
		expect(parseAutomodReasons('type: submission\naction: report\n',),).toEqual([],)
	})

	it('extracts action_reason only from rules whose action is report, stripping quotes/indentation', () => {
		const config = [
			'---',
			'type: submission',
			'action: report',
			'action_reason: "Low effort post"',
			'---',
			'type: comment',
			'action: report',
			'    action_reason: \'Rule 3: be civil\'',
		].join('\n',)

		expect(parseAutomodReasons(config,),).toEqual(['Low effort post', 'Rule 3: be civil',],)
	})

	it('ignores action_reason on non-report rules (filter/remove)', () => {
		const config = [
			'---',
			'action: filter',
			'action_reason: filtered new account',
			'---',
			'action: remove',
			'action_reason: removed spam',
			'---',
			'action: report',
			'action_reason: reported reason',
		].join('\n',)

		expect(parseAutomodReasons(config,),).toEqual(['reported reason',],)
	})

	it('ignores an action_reason with no action: report in its rule', () => {
		expect(parseAutomodReasons('type: submission\naction_reason: orphan reason',),).toEqual([],)
	})

	it('accepts a quoted action value and de-duplicates case-insensitively', () => {
		const config = [
			'action: "report"',
			'action_reason: Spam',
			'---',
			'action: report',
			'action_reason: "SPAM"',
		].join('\n',)

		expect(parseAutomodReasons(config,),).toEqual(['Spam',],)
	})

	it('skips empty values and block-scalar indicators', () => {
		const config = [
			'action: report',
			'action_reason:',
			'---',
			'action: report',
			'action_reason: >',
			'---',
			'action: report',
			'action_reason: kept',
		].join('\n',)

		expect(parseAutomodReasons(config,),).toEqual(['kept',],)
	})
})
