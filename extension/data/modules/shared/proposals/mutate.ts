/**
 * `mutateProposals` - the single serialized, conflict-safe entry point for every
 * change to a subreddit's proposals page (append, accept, reject, dismiss,
 * obsolete-mark, prune).
 *
 * A thin adapter over the generic {@link mutateWikiPage} primitive: it supplies the
 * proposals page path, codec, the proposals-specific cache/event side effects, and the
 * forward-compatible schema-version write guard. The primitive provides the rest:
 * - **Per-subreddit serialization** of this client's mutations to the proposals page.
 * - **Cross-client safety** - each attempt reads current state, applies the mutator,
 *   and writes conditioned on that revision; a concurrent writer causes a 409 and the
 *   mutator is re-applied against the fresh state.
 * - **No silent overwrites** - a mutator that finds its target already terminal returns
 *   `write: false`, and a page written by a newer schema (`ver > proposalsSchema`) is
 *   refused rather than clobbered with our lossy view.
 *
 * The mutator must be re-runnable: it is invoked fresh with the latest data on every
 * conflict retry and must re-derive its decision from that data.
 */

import {mutateWikiPage, type MutatorOutcome as GenericMutatorOutcome,} from '../../../util/wiki/mutateWikiPage'
import {proposalsCodec,} from '../../../util/wiki/schemas/proposals/codec'
import {type ProposalsData, proposalsSchema,} from '../../../util/wiki/schemas/proposals/schema'
import {broadcastProposalsChanged, emitProposalsChanged, setCachedProposals,} from './events'
import {getProposalsPagePath,} from './paths'

/**
 * The outcome of applying a mutator to the current proposals data.
 * - `write: true` - the mutator changed `data`; persist it and return `result`.
 * - `write: false` - no change is warranted (e.g. the target is already resolved);
 *   skip the write entirely and return `result` (typically a typed conflict/no-op).
 *
 * `result` is the caller-defined value `mutateProposals` resolves with, so callers
 * can surface "already resolved by u/X" without throwing. (A back-compat alias over
 * the generic {@link GenericMutatorOutcome}; proposals never use its `abort` variant.)
 */
export type MutatorOutcome<T,> =
	| {write: true; result: T}
	| {write: false; result: T}

/**
 * A mutation applied to proposals data. Receives the current (mutable) data and
 * returns whether to persist plus a typed result. MUST be idempotent in intent:
 * it is re-invoked with fresh data on every conflict retry.
 */
export type ProposalsMutator<T,> = (data: ProposalsData,) => MutatorOutcome<T>

/**
 * Serialized, conflict-safe mutation of a subreddit's proposals page.
 * @param subreddit The subreddit to mutate.
 * @param mutator The mutation to apply (see {@link ProposalsMutator}).
 * @param reason The wiki revision note.
 * @returns The mutator's `result`. Rejects only on transport failure, a refusal to
 *   overwrite a newer-schema page, or after exhausting conflict retries.
 */
export function mutateProposals<T,> (
	subreddit: string,
	mutator: ProposalsMutator<T>,
	reason: string,
): Promise<T> {
	// Bump the monotonic page version on every committed write. Persisting it with the
	// data gives display caches (this tab's and other tabs', via the broadcast) a single
	// lag-proof order. Re-derived correctly on conflict retries: `mutateWikiPage` re-runs
	// the mutator against the fresh 409 state, which already carries the winner's higher
	// `seq`, so the retried write is always `latest + 1`.
	const versionedMutator: ProposalsMutator<T> = (data,) => {
		const outcome = mutator(data,)
		if (outcome.write) {
			data.seq = (data.seq ?? 0) + 1
		}
		return outcome
	}
	return mutateWikiPage<ProposalsData, T>({
		subreddit,
		page: getProposalsPagePath(),
		codec: proposalsCodec,
		reason,
		mutator: versionedMutator,
		writeOptions: {listed: 'false',},
		// The page was written by a newer client whose schema we can't fully parse -
		// `normalizeProposalsData` dropped any proposals/fields this build doesn't know.
		// Writing back our lossy view would discard that newer data, so refuse rather
		// than clobber. (Read-only/display paths tolerate the partial view; only a write
		// is destructive.) Re-checked each attempt since a 409 can surface newer data.
		refuseWrite: (data,) =>
			data.ver > proposalsSchema
				? `proposals page for /r/${subreddit} is schema v${data.ver}, newer than supported `
					+ `v${proposalsSchema}; refusing to write to avoid discarding newer data`
				: undefined,
		// Trust the in-memory post-write state (do not re-read; ~190 ms lag). The data
		// carries the freshly-bumped `seq`, so the monotonic cache always accepts it.
		onCommit: (subreddit, data,) => {
			setCachedProposals(subreddit, data,)
			emitProposalsChanged(subreddit,)
			// Mirror the change into every other open tab; this is the only local
			// mutation origin, so it's the sole broadcast site.
			broadcastProposalsChanged(subreddit, data,)
		},
		// Refresh the display cache with the canonical data we just read so the UI
		// reflects reality even when nothing was written.
		onNoop: (subreddit, data,) => setCachedProposals(subreddit, data,),
	},)
}
