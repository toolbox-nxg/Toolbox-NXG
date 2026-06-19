/**
 * Canonical convention for function parameter ordering and naming across the
 * `extension/` source tree. This file is pure data — the single source of truth
 * consumed by `check-param-order.mjs`. Nothing here edits code; tuning these
 * lists changes only what the scanner reports.
 *
 * A "concept" is a domain idea that recurs as a function parameter (a
 * subreddit, a user, a submission, …). Each concept has:
 *   - `canonical`: the one name every parameter of this concept should use.
 *   - `synonyms`: other names seen in the wild that mean the same concept and
 *     should be reported as naming violations (told to rename to `canonical`).
 *
 * The ORDER of the `CONCEPTS` array is the canonical parameter order: a concept
 * earlier in the array must appear earlier in a function's parameter list than
 * any concept later in the array.
 */

/**
 * @typedef {object} ConceptDef
 * @property {string} canonical The single approved name for this concept.
 * @property {string[]} synonyms Alternate names that should be renamed to `canonical`.
 *   The canonical name is matched case-insensitively and need not be repeated here.
 */

/**
 * Ordered list of recognized concepts, earliest parameter first. Editing this
 * order changes the canonical ordering the scanner enforces.
 * @type {ConceptDef[]}
 */
export const CONCEPTS = [
	// The DOM element being operated on is the subject of the action and comes
	// first. `target` and `node` are intentionally NOT synonyms: both are
	// overloaded and cannot be classified by name alone (this scanner is
	// name-only, no types). `target` is a DOM `Element` in some places but a flair
	// payload object, an `EventTarget`, a `Node`, or an arbitrary config object in
	// others; `node` is a DOM `Node` (broader than `Element`, includes text nodes
	// — e.g. the highlight text-node walkers), where renaming to `element` would
	// be incorrect. Only the literal name `element` is treated as this concept.
	{canonical: 'element', synonyms: [],},

	// A subreddit's bare name (e.g. `funny`), not a path. `subredditName` is
	// intentionally NOT a synonym: it is an explicit name often paired with a
	// sibling `subredditUrl`/`subredditPath` (where collapsing it to `subreddit`
	// would lose the distinction), and it travels through JSX props and
	// custom-event detail contracts where a blind rename is unsafe.
	{canonical: 'subreddit', synonyms: ['sub',],},

	// A subreddit PATH (e.g. `/r/funny/...`) is a different value from a bare
	// name, so it is its own concept rather than a synonym of `subreddit`.
	{canonical: 'subredditPath', synonyms: [],},

	// A user / account. `author` is intentionally NOT a synonym: it is overloaded —
	// sometimes a boolean flag (e.g. an "author context" prop), and elsewhere the
	// precise domain term for the *content* author (a usernote's subject, a deleted
	// commenter), which is meaningfully distinct from a generic acted-on `user`.
	{canonical: 'user', synonyms: ['username',],},

	// A link/self post. Canonical name is `submission`. `postLink` and `link` are
	// intentionally NOT synonyms: both are overloaded — `link` is sometimes a raw
	// URL being submitted (not a reference to a submission), and `postLink` is a
	// submission's fullname (the `fullname` concept), so neither cleanly maps here.
	{canonical: 'submission', synonyms: ['post',],},

	// A comment.
	{canonical: 'comment', synonyms: [],},

	// A fully-qualified "thing" id carrying a type prefix, e.g. `t1_abcdef`.
	// Note: `thing` is intentionally NOT a synonym here. Across the codebase
	// `thing` consistently means a Reddit "thing" — the `.thing` DOM element in
	// the DOM layers, or the raw API data object in the API/data layers — never a
	// bare fullname string. It is a distinct, consistently-used domain term and is
	// left unrecognized so it is neither renamed nor ordered against `fullname`.
	{canonical: 'fullname', synonyms: [],},

	// A BARE base-36 id, e.g. `abcdef` — a different value from a `fullname`,
	// so it is kept as a separate concept rather than folded together.
	{canonical: 'id', synonyms: [],},
]

/**
 * Priority assigned to a recognized data parameter that is not one of the
 * `CONCEPTS` above (e.g. `text`, `reason`, `title`). These must come after every
 * recognized concept but keep their relative order among themselves.
 */
export const DATA_PRIORITY = CONCEPTS.length

/**
 * Priority assigned to a destructured/config object parameter. An options object
 * is always the last parameter.
 */
export const OPTIONS_PRIORITY = CONCEPTS.length + 1

/**
 * Builds a lookup from a lower-cased parameter name to its concept's canonical
 * name and ordering priority. Both the canonical name and every synonym map to
 * the same entry.
 * @returns {Map<string, {canonical: string, priority: number}>} The synonym→concept index.
 */
export function buildConceptLookup () {
	/** @type {Map<string, {canonical: string, priority: number}>} */
	const lookup = new Map()
	CONCEPTS.forEach((def, priority,) => {
		// The canonical name itself is a valid (non-violating) name for the concept.
		lookup.set(def.canonical.toLowerCase(), {canonical: def.canonical, priority,},)
		// Every synonym maps to the same concept but will be flagged as a rename.
		for (const synonym of def.synonyms) {
			lookup.set(synonym.toLowerCase(), {canonical: def.canonical, priority,},)
		}
	},)
	return lookup
}
