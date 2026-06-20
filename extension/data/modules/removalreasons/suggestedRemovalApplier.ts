/**
 * Cross-module entry point for the one-click "apply suggested removal" action. Like
 * {@link ./overlayOpener}, the applier is a closure inside `createRemovalReasonsHandlers`
 * (it captures the module's settings and private overlay-data helpers), registered here at
 * init so other modules (the modview queue button) can trigger a suggested removal without
 * reaching into removalreasons internals or importing moderation primitives.
 */

/** Options accepted by the suggested-removal applier. */
export interface ApplySuggestedRemovalOptions {
	/** Fullname of the thing to remove (`t3_...`/`t1_...`). */
	thingID: string
	/** Subreddit the thing belongs to (no `r/` prefix). */
	thingSubreddit: string
	/** Whether the thing is a comment (vs a post). */
	isComment: boolean
	/** Persistent removal-reason ids to apply, in suggestion order. */
	reasonIds: string[]
}

/** Result of applying a suggested removal. */
export interface ApplySuggestedRemovalResult {
	/** Whether the removal was performed or captured for review (vs. failing/aborting). */
	ok: boolean
	/** True when the action was captured as a proposal instead of performed (training/review). */
	captured?: boolean
}

type Applier = (options: ApplySuggestedRemovalOptions,) => Promise<ApplySuggestedRemovalResult>
type SuggestionResolver = (
	subreddit: string,
	thingElement: Element | null,
	isComment: boolean,
) => Promise<string[]>

let applier: Applier | null = null
let suggestionResolver: SuggestionResolver | null = null

/**
 * Registers the live applier (called once when the removalreasons handlers initialize) and
 * cleared on teardown. Injectable so tests and other modules need not import the handlers factory.
 * @param fn The applier, or `null` to unregister.
 */
export function setSuggestedRemovalApplier (fn: Applier | null,): void {
	applier = fn
}

/**
 * Applies a suggested removal for a thing. A no-op returning `{ok: false}` when the
 * removalreasons module is not active (no applier registered).
 * @param options Which thing to remove and which reasons to apply.
 */
export function applySuggestedRemoval (
	options: ApplySuggestedRemovalOptions,
): Promise<ApplySuggestedRemovalResult> {
	return applier?.(options,) ?? Promise.resolve({ok: false,},)
}

/**
 * Registers the live one-click suggestion resolver, cleared on teardown. Injectable so the
 * modview queue button can resolve suggestions without importing the removalreasons config stack.
 * @param fn The resolver, or `null` to unregister.
 */
export function setOneClickSuggestionResolver (fn: SuggestionResolver | null,): void {
	suggestionResolver = fn
}

/**
 * Resolves the one-click suggested-removal reason ids for a queue item — already filtered to
 * reasons applicable to the item's kind — or `[]` when the removalreasons module is not active
 * (no resolver registered).
 * @param subreddit The item's subreddit.
 * @param thingElement The queue-item element (or a descendant).
 * @param isComment Whether the item is a comment (vs a post); reasons not applicable to this
 *   kind are excluded so the button is never shown for an inapplicable reason.
 */
export function getOneClickSuggestionsForItem (
	subreddit: string,
	thingElement: Element | null,
	isComment: boolean,
): Promise<string[]> {
	return suggestionResolver?.(subreddit, thingElement, isComment,) ?? Promise.resolve([],)
}
