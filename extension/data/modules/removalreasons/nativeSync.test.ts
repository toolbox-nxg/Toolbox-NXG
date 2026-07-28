// @vitest-environment node
/** Tests for the pure native-reason merge and fingerprint. */

import {describe, expect, it,} from 'vitest'

import type {NativeRemovalReason,} from '../../api/resources/removalReasons'
import {mergeNativeReasons, nativeReasonsFingerprint,} from './nativeSync'
import type {RemovalReason,} from './schema'

/** Builds a native reason. */
function native (id: string, title: string, message: string,): NativeRemovalReason {
	return {id, title, message,}
}

/** Builds a configured toolbox reason, optionally linked to a native id. */
function reason (overrides: Partial<RemovalReason> = {},): RemovalReason {
	return {
		text: 'body',
		title: 'title',
		flairText: '',
		flairCSS: '',
		flairTemplateID: '',
		...overrides,
	}
}

describe('mergeNativeReasons adding', () => {
	it('appends native reasons in display order with a link and blank flair', () => {
		const result = mergeNativeReasons([], [
			native('n1', 'First', 'First body',),
			native('n2', 'Second', 'Second body',),
		],)

		expect(result.changed,).toBe(true,)
		expect(result.added,).toBe(2,)
		expect(result.reasons.map((r,) => r.title),).toEqual(['First', 'Second',],)
		expect(result.reasons[0],).toEqual({
			text: 'First body',
			title: 'First',
			flairText: '',
			flairCSS: '',
			flairTemplateID: '',
			nativeReasonId: 'n1',
		},)
	})

	it('omits the applicability flags so they fall back to toolbox defaults', () => {
		const [imported,] = mergeNativeReasons([], [native('n1', 'First', 'body',),],).reasons
		// Absent removePosts means "applies to posts"; absent removeComments defers to the
		// moderator's enable-for-comments setting. Writing false would override both.
		expect('removePosts' in imported!,).toBe(false,)
		expect('removeComments' in imported!,).toBe(false,)
	})

	it('appends new native reasons after the existing list', () => {
		const existing = [reason({title: 'Hand written',},),]
		const result = mergeNativeReasons(existing, [native('n1', 'From Reddit', 'body',),],)

		expect(result.reasons.map((r,) => r.title),).toEqual(['Hand written', 'From Reddit',],)
	})
})

describe('mergeNativeReasons updating', () => {
	it('refreshes title and text on a linked reason', () => {
		const existing = [reason({nativeReasonId: 'n1', title: 'Stale', text: 'Stale body',},),]
		const result = mergeNativeReasons(existing, [native('n1', 'Fresh', 'Fresh body',),],)

		expect(result.changed,).toBe(true,)
		expect(result.updated,).toBe(1,)
		expect(result.reasons[0]!.title,).toBe('Fresh',)
		expect(result.reasons[0]!.text,).toBe('Fresh body',)
	})

	it('preserves every toolbox-owned field through an update', () => {
		const existing = [reason({
			id: 'abcd1234',
			nativeReasonId: 'n1',
			title: 'Stale',
			text: 'Stale body',
			removePosts: false,
			removeComments: true,
			flairText: 'Removed',
			flairCSS: 'removed',
			flairTemplateID: 'tpl-1',
			editable: true,
			default_note: 'noted',
			default_note_type: 'spamwarn',
		},),]

		const [merged,] = mergeNativeReasons(existing, [native('n1', 'Fresh', 'Fresh body',),],).reasons

		expect(merged,).toEqual({
			id: 'abcd1234',
			nativeReasonId: 'n1',
			title: 'Fresh',
			text: 'Fresh body',
			removePosts: false,
			removeComments: true,
			flairText: 'Removed',
			flairCSS: 'removed',
			flairTemplateID: 'tpl-1',
			editable: true,
			default_note: 'noted',
			default_note_type: 'spamwarn',
		},)
	})
})

describe('mergeNativeReasons deleting', () => {
	it('drops a linked reason whose native reason is gone, keeping the others in order', () => {
		const existing = [
			reason({title: 'Hand written',},),
			reason({nativeReasonId: 'n1', title: 'Gone',},),
			reason({nativeReasonId: 'n2', title: 'Kept', text: 'body',},),
		]
		const result = mergeNativeReasons(existing, [native('n2', 'Kept', 'body',),],)

		expect(result.removed,).toBe(1,)
		expect(result.reasons.map((r,) => r.title),).toEqual(['Hand written', 'Kept',],)
	})

	it('drops every linked reason when the native list is empty', () => {
		const existing = [
			reason({nativeReasonId: 'n1',},),
			reason({title: 'Hand written',},),
		]
		const result = mergeNativeReasons(existing, [],)

		expect(result.changed,).toBe(true,)
		expect(result.removed,).toBe(1,)
		expect(result.reasons.map((r,) => r.title),).toEqual(['Hand written',],)
	})

	it('dedupes two reasons sharing a native id, keeping the first', () => {
		const existing = [
			reason({nativeReasonId: 'n1', title: 'Kept', text: 'body',},),
			reason({nativeReasonId: 'n1', title: 'Duplicate', text: 'body',},),
		]
		const result = mergeNativeReasons(existing, [native('n1', 'Kept', 'body',),],)

		expect(result.removed,).toBe(1,)
		expect(result.reasons.map((r,) => r.title),).toEqual(['Kept',],)
	})
})

describe('mergeNativeReasons stability', () => {
	it('reports no change and preserves object identity when nothing moved', () => {
		const linked = reason({nativeReasonId: 'n1', title: 'Same', text: 'body',},)
		const handWritten = reason({title: 'Hand written',},)
		const result = mergeNativeReasons([handWritten, linked,], [native('n1', 'Same', 'body',),],)

		expect(result.changed,).toBe(false,)
		expect(result.reasons[0],).toBe(handWritten,)
		expect(result.reasons[1],).toBe(linked,)
	})

	it('leaves a hand-written reason alone even when a native reason shares its title', () => {
		const handWritten = reason({title: 'Spam', text: 'Local wording',},)
		const result = mergeNativeReasons([handWritten,], [native('n1', 'Spam', 'Reddit wording',),],)

		expect(result.reasons[0],).toBe(handWritten,)
		expect(result.reasons[0]!.text,).toBe('Local wording',)
		expect(result.added,).toBe(1,)
	})

	it('does not reposition anything when the native order changes', () => {
		const existing = [
			reason({nativeReasonId: 'n2', title: 'Second', text: 'b',},),
			reason({nativeReasonId: 'n1', title: 'First', text: 'a',},),
		]
		const result = mergeNativeReasons(existing, [
			native('n1', 'First', 'a',),
			native('n2', 'Second', 'b',),
		],)

		expect(result.changed,).toBe(false,)
		expect(result.reasons.map((r,) => r.title),).toEqual(['Second', 'First',],)
	})

	it('is idempotent', () => {
		const reasons = [native('n1', 'First', 'a',), native('n2', 'Second', 'b',),]
		const once = mergeNativeReasons([reason({title: 'Hand written',},),], reasons,)
		const twice = mergeNativeReasons(once.reasons, reasons,)

		expect(once.changed,).toBe(true,)
		expect(twice.changed,).toBe(false,)
		expect(twice.reasons,).toEqual(once.reasons,)
	})

	it('does not mutate the input list or its entries', () => {
		const linked = reason({nativeReasonId: 'n1', title: 'Stale', text: 'Stale body',},)
		const existing = [linked,]
		mergeNativeReasons(existing, [native('n1', 'Fresh', 'Fresh body',),],)

		expect(existing,).toHaveLength(1,)
		expect(linked.title,).toBe('Stale',)
		expect(linked.text,).toBe('Stale body',)
	})
})

describe('mergeNativeReasons ignored ids', () => {
	it('does not re-import an ignored native reason', () => {
		const result = mergeNativeReasons([], [native('n1', 'First', 'a',), native('n2', 'Second', 'b',),], ['n1',],)

		expect(result.added,).toBe(1,)
		expect(result.reasons.map((r,) => r.title),).toEqual(['Second',],)
	})

	it('drops an existing reason whose native id became ignored', () => {
		const existing = [reason({nativeReasonId: 'n1', title: 'First', text: 'a',},),]
		const result = mergeNativeReasons(existing, [native('n1', 'First', 'a',),], ['n1',],)

		expect(result.removed,).toBe(1,)
		expect(result.reasons,).toEqual([],)
	})
})

describe('nativeReasonsFingerprint', () => {
	const reasons = [native('n1', 'First', 'a',), native('n2', 'Second', 'b',),]

	it('ignores ordering', () => {
		expect(nativeReasonsFingerprint([...reasons,].reverse(),),).toBe(nativeReasonsFingerprint(reasons,),)
	})

	it('changes when an id, title, or message changes', () => {
		const base = nativeReasonsFingerprint(reasons,)
		expect(nativeReasonsFingerprint([native('n1', 'First', 'a',), native('n3', 'Second', 'b',),],),).not.toBe(base,)
		expect(nativeReasonsFingerprint([native('n1', 'Changed', 'a',), reasons[1]!,],),).not.toBe(base,)
		expect(nativeReasonsFingerprint([native('n1', 'First', 'changed',), reasons[1]!,],),).not.toBe(base,)
	})

	it('changes when a reason is added or removed', () => {
		const base = nativeReasonsFingerprint(reasons,)
		expect(nativeReasonsFingerprint([reasons[0]!,],),).not.toBe(base,)
		expect(nativeReasonsFingerprint([...reasons, native('n3', 'Third', 'c',),],),).not.toBe(base,)
	})

	it('is stable and non-empty for an empty set', () => {
		expect(nativeReasonsFingerprint([],),).toBe(nativeReasonsFingerprint([],),)
		expect(nativeReasonsFingerprint([],),).toMatch(/^[0-9a-f]{16}$/,)
	})

	it('does not confuse field boundaries', () => {
		// A separator-free concatenation would collide these two.
		expect(nativeReasonsFingerprint([native('n1', 'ab', 'c',),],),)
			.not.toBe(nativeReasonsFingerprint([native('n1', 'a', 'bc',),],),)
	})

	it('does not mutate its input', () => {
		const input = [native('n2', 'Second', 'b',), native('n1', 'First', 'a',),]
		nativeReasonsFingerprint(input,)
		expect(input.map((r,) => r.id),).toEqual(['n2', 'n1',],)
	})
})
