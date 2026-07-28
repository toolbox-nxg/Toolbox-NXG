/** Pure merge of Reddit's native removal reasons into a subreddit's configured toolbox reasons. */

import type {NativeRemovalReason,} from '../../api/resources/removalReasons'
import type {RemovalReason,} from './schema'

/** Outcome of merging a native reason set into the configured reasons. */
export interface NativeSyncResult {
	/** The merged reason list. Unchanged entries keep their original object identity. */
	reasons: RemovalReason[]
	/** Whether anything actually moved; false means the caller should not write. */
	changed: boolean
	/** Count of native reasons appended as new toolbox reasons. */
	added: number
	/** Count of linked reasons whose title or text was refreshed from Reddit. */
	updated: number
	/** Count of linked reasons dropped because they no longer exist upstream. */
	removed: number
}

/** Field separator inside one reason's digest input. */
const fieldSeparator = '\u001f'
/** Record separator between reasons' digest inputs. */
const recordSeparator = '\u001e'

/**
 * FNV-1a over a string, seeded with the given offset basis. Returns an unsigned
 * 32-bit value. Two runs with different bases are concatenated to form the
 * fingerprint, because a collision would silently suppress a sync forever.
 * @param text The string to hash.
 * @param offsetBasis The FNV offset basis to seed with.
 */
function fnv1a (text: string, offsetBasis: number,): number {
	let hash = offsetBasis
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i,)
		// The usual FNV prime multiply, decomposed into shifts so it stays in 32-bit
		// integer range instead of losing precision through a float multiply.
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
		hash >>>= 0
	}
	return hash >>> 0
}

/**
 * Digests a native reason set so a later sync can tell at a glance whether anything
 * upstream changed, without merging.
 *
 * Deliberately order-independent: the merge never repositions existing reasons, so a
 * moderator reordering reasons in Reddit's mod tools produces no toolbox change. Were
 * order part of the digest, such a reorder would leave the fingerprint permanently
 * mismatched while every merge came back empty. Sorting by id keeps the useful
 * invariant that a changed fingerprint means the merge has work to do.
 * @param native The native reasons to digest.
 */
export function nativeReasonsFingerprint (native: NativeRemovalReason[],): string {
	const input = [...native,]
		.sort((a, b,) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
		.map((reason,) => [reason.id, reason.title, reason.message,].join(fieldSeparator,))
		.join(recordSeparator,)
	const low = fnv1a(input, 0x811c9dc5,).toString(16,).padStart(8, '0',)
	const high = fnv1a(input, 0x01000193,).toString(16,).padStart(8, '0',)
	return `${high}${low}`
}

/**
 * Merges a native reason set into the configured reasons, one way: Reddit owns the
 * title and text of every linked reason, and everything else on that reason is left
 * alone.
 *
 * Ordering is preserved rather than imposed. Existing reasons stay where the moderator
 * put them (reordering is a first-class editor affordance, and hand-written reasons
 * interleave with synced ones), and newly imported reasons are appended in Reddit's
 * display order.
 *
 * The input is never mutated, and entries that need no change are returned by
 * reference, so callers can use identity to detect a no-op.
 * @param existing The currently configured reasons.
 * @param native The native reasons fetched from Reddit, in display order.
 * @param ignored Native ids a moderator deleted locally; never re-imported.
 */
export function mergeNativeReasons (
	existing: RemovalReason[],
	native: NativeRemovalReason[],
	ignored?: string[],
): NativeSyncResult {
	const ignoredIds = new Set(ignored ?? [],)
	const available = native.filter((reason,) => !ignoredIds.has(reason.id,))
	const byId = new Map(available.map((reason,) => [reason.id, reason,]),)
	const consumed = new Set<string>()

	const reasons: RemovalReason[] = []
	let updated = 0
	let removed = 0

	for (const reason of existing) {
		const linkId = reason.nativeReasonId
		if (linkId === undefined) {
			// Hand-written reasons are none of the sync's business, even if their title
			// happens to match a native one.
			reasons.push(reason,)
			continue
		}
		const match = byId.get(linkId,)
		if (!match || consumed.has(linkId,)) {
			// Either deleted upstream (or locally ignored), or a duplicate link left behind
			// by an earlier legacy-mirror round-trip. Dropping the later duplicate keeps the
			// result deterministic and self-healing.
			removed++
			continue
		}
		consumed.add(linkId,)
		if (reason.title === match.title && reason.text === match.message) {
			reasons.push(reason,)
			continue
		}
		// Only title and text are Reddit's; the spread carries every toolbox-owned extra
		// (flair, usernote defaults, post/comment applicability, the stable id) across.
		reasons.push({...reason, title: match.title, text: match.message,},)
		updated++
	}

	let added = 0
	for (const reason of available) {
		if (consumed.has(reason.id,)) { continue }
		// No `id`: `ensureStableIds` mints one on the next normalize. No `removePosts` or
		// `removeComments`: absent means "applies to posts" and "defer to the moderator's
		// enable-for-comments setting", which is the right default for a fresh reason.
		reasons.push({
			text: reason.message,
			title: reason.title,
			flairText: '',
			flairCSS: '',
			flairTemplateID: '',
			nativeReasonId: reason.id,
		},)
		added++
	}

	return {reasons, changed: added + updated + removed > 0, added, updated, removed,}
}

/**
 * Drops every reason linked to a native one, for when a subreddit turns the sync off.
 *
 * A linked reason's title and message are Reddit's, so what would survive the sync being
 * switched off is a frozen copy nobody maintains. The toolbox-owned extras on those
 * reasons (flair, usernote defaults) go with them, which is why the caller confirms first.
 *
 * The input is never mutated, and the surviving entries are returned by reference.
 * @param existing The currently configured reasons.
 */
export function stripNativeReasons (existing: RemovalReason[],): {reasons: RemovalReason[]; removed: number} {
	const reasons = existing.filter((reason,) => reason.nativeReasonId === undefined)
	return {reasons, removed: existing.length - reasons.length,}
}
