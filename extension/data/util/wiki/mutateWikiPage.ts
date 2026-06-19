/**
 * `mutateWikiPage` - a serialized, conflict-safe read-apply-write loop for a single
 * wiki page. The generic primitive behind `mutateProposals` and any other single-page
 * read-modify-write consumer that must not clobber a concurrent edit.
 *
 * Guarantees:
 * - **Per-page serialization.** Concurrent mutations of the same `<sub>/<page>` from
 *   this client run one at a time, so a later one can't race an earlier in-flight write.
 * - **Cross-client safety.** Each attempt reads the current canonical state, applies
 *   the mutator to it, and writes conditioned on that revision. A concurrent writer
 *   elsewhere causes a 409; the mutator is re-applied against the fresh state from the
 *   conflict body and retried (bounded).
 * - **No silent overwrites.** Two refusal seams stop a write from discarding data we
 *   did not understand:
 *     1. *Parse-time* - the codec's `parse` returns `{ok:false}` (content can't be
 *        interpreted); the loop refuses before the mutator runs.
 *     2. *Write-time* - the optional {@link MutateWikiPageConfig.refuseWrite} guard
 *        rejects based on the parsed value (e.g. a newer schema version we must not
 *        overwrite), re-checked every attempt since a 409 can surface newer data.
 *   The mutator may also decline per attempt (`write: false`) or hard-abort.
 *
 * The mutator and `refuseWrite` are re-invoked with fresh data on every conflict retry,
 * so both must re-derive their decision from the data they are given.
 */

import {
	readWikiPageVersioned,
	type WikiPageCodec,
	type WikiVersionedWriteOptions,
	writeWikiPageConditional,
} from '../../api/resources/wikiVersioned'
import {delay,} from '../data/async'
import createLogger from '../infra/logging'
import {createPerKeyQueue,} from '../infra/perKeyQueue'

const log = createLogger('TBApi',)

/** Default maximum read-apply-write attempts before giving up on persistent conflicts. */
const DEFAULT_MAX_ATTEMPTS = 6

/**
 * Default inter-retry backoff: exponential (50ms, 100ms, 200ms, ... capped at 1s) plus up
 * to 100ms of jitter, so two clients contending on the same page don't retry in lock-step.
 * Network round-trips already space attempts; this just de-syncs them.
 * @param attempt The just-failed attempt index (0-based).
 */
function defaultBackoff (attempt: number,): Promise<void> {
	const base = Math.min(50 * 2 ** attempt, 1000,)
	return delay(base + Math.random() * 100,)
}

/**
 * The outcome of applying a mutator to the current page data.
 * - `write: true` - the mutator changed `data`; persist it and resolve with `result`.
 * - `write: false` with `result` - no change is warranted (e.g. target already resolved);
 *   skip the write and resolve with `result`.
 * - `write: false` with `abort` - refuse to proceed; reject with the given error.
 */
export type MutatorOutcome<R,> =
	| {write: true; result: R}
	| {write: false; result: R}
	| {write: false; abort: Error}

/**
 * A mutation applied to a page's data. Receives the current (mutable) data and returns
 * whether to persist plus a typed result. Re-invoked with fresh data on every conflict
 * retry, so it must re-derive its decision from the data it is given.
 */
export type WikiMutator<T, R,> = (data: T,) => MutatorOutcome<R>

/** Configuration for a single {@link mutateWikiPage} call. */
export interface MutateWikiPageConfig<T, R,> {
	/** The subreddit the page belongs to (also part of the serialization key). */
	subreddit: string
	/** The wiki page path (also part of the serialization key). */
	page: string
	/** The payload codec for this page. */
	codec: WikiPageCodec<T>
	/** The wiki revision note. */
	reason: string
	/** The mutation to apply (see {@link WikiMutator}). */
	mutator: WikiMutator<T, R>
	/** Per-page write behavior (visibility, tab handling, reason format). */
	writeOptions: WikiVersionedWriteOptions
	/**
	 * Optional pre-write guard, re-checked each attempt (including against the fresh
	 * data a 409 surfaces). Return a reason string to refuse the write - the call
	 * rejects with that message - or `undefined` to proceed.
	 */
	refuseWrite?: (data: T,) => string | undefined
	/** Side effect after a committed write (e.g. refresh cache + emit a change event). */
	onCommit?: (subreddit: string, data: T,) => void
	/** Side effect on a no-write outcome (e.g. refresh the display cache with read data). */
	onNoop?: (subreddit: string, data: T,) => void
	/** Override the retry bound (default {@link DEFAULT_MAX_ATTEMPTS}). */
	maxAttempts?: number
	/**
	 * Delay before re-attempting after a 409 conflict (receives the just-failed attempt
	 * index). Defaults to exponential backoff with jitter; pass `() => Promise.resolve()`
	 * to retry immediately (e.g. in tests).
	 */
	backoff?: (attempt: number,) => Promise<void>
}

const enqueue = createPerKeyQueue()

/**
 * Serialized, conflict-safe mutation of a single wiki page.
 * @param config The mutation configuration (see {@link MutateWikiPageConfig}).
 * @returns The mutator's `result`. Rejects on transport failure, a refusal (parse-time,
 *   write-time, or mutator abort), or after exhausting conflict retries.
 */
export function mutateWikiPage<T, R,> (config: MutateWikiPageConfig<T, R>,): Promise<R> {
	return enqueue(`${config.subreddit}/${config.page}`, () => doMutate(config,),)
}

/** Core read-apply-write loop, run inside the per-page queue. */
async function doMutate<T, R,> (config: MutateWikiPageConfig<T, R>,): Promise<R> {
	const {subreddit, page, codec, reason, mutator, writeOptions, refuseWrite, onCommit, onNoop,} = config
	const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
	const backoff = config.backoff ?? defaultBackoff

	let read = await readWikiPageVersioned(subreddit, page, codec,)
	// The page exists but the codec refused to parse it; overwriting would discard
	// content we could not interpret, so refuse rather than clobber.
	if (read.unparseable) {
		throw new Error(read.unparseable.reason,)
	}

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// Write-time refusal seam, re-checked each attempt because a 409 can surface
		// newer data than the original read.
		const refusal = refuseWrite?.(read.data,)
		if (refusal !== undefined) {
			throw new Error(refusal,)
		}

		const outcome = mutator(read.data,)

		if (!outcome.write) {
			if ('abort' in outcome) {
				throw outcome.abort
			}
			// Nothing to persist (e.g. target already terminal). Let the caller refresh
			// its display cache with the canonical data we just read.
			onNoop?.(subreddit, read.data,)
			return outcome.result
		}

		const writeResult = await writeWikiPageConditional(
			subreddit,
			page,
			read.data,
			reason,
			read.rev,
			codec,
			writeOptions,
		)

		if (writeResult.ok) {
			onCommit?.(subreddit, read.data,)
			return outcome.result
		}

		if (writeResult.conflict) {
			// The fresh canonical state from the 409 is itself unparseable - refuse.
			if (writeResult.unparseable) {
				throw new Error(writeResult.unparseable.reason,)
			}
			// Re-apply the mutator against the fresh canonical state and retry, after a
			// short backoff so contending clients don't lock-step their retries.
			read = {data: writeResult.data, rev: writeResult.rev,}
			await backoff(attempt,)
			continue
		}

		throw writeResult.error
	}

	const message = `mutateWikiPage: exhausted ${maxAttempts} conflict retries for /r/${subreddit}/${page}`
	log.error(message,)
	throw new Error(message,)
}
