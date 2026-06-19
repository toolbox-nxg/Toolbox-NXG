/**
 * Resolves the effective "what a usernote must contain before it can be saved"
 * requirements for type, text, and link by combining a subreddit's config flags
 * (and their enforcement mode) with the acting moderator's personal settings.
 *
 * The rule is "more restrictive wins": under the `'suggest'` and `'force'` modes
 * the subreddit's flags act as a floor - a field is required if either the
 * subreddit or the moderator demands it - so a moderator may opt into stricter
 * rules but never drop below the subreddit. Any other mode (including the absent
 * default and `'leave'`) ignores the subreddit flags entirely and defers to the
 * moderator's own settings.
 */

import type {ToolboxConfig,} from '../../../util/wiki/schemas/config/schema'

/** A set of per-field "is this required" booleans for type, text, and link. */
export interface UsernoteRequireFlags {
	/** Whether a note type/tag is required. */
	type: boolean
	/** Whether note body text is required. */
	text: boolean
	/** Whether a link to the content is required. */
	link: boolean
}

/** A subreddit's requirement flags plus the enforcement mode that gates them. */
export interface SubUsernoteRequire extends UsernoteRequireFlags {
	/**
	 * The subreddit's `usernoteRequirementOption`: `'suggest'`/`'force'` make the
	 * flags a floor; anything else (including `undefined`/`'leave'`) defers to the
	 * moderator's personal settings. The token set matches removal reasons'
	 * `removalOption`.
	 */
	mode: string | undefined
}

/** The slice of {@link ToolboxConfig} that carries usernote save-requirements. */
type RequireConfig = Pick<
	ToolboxConfig,
	'requireUsernoteType' | 'requireUsernoteText' | 'requireUsernoteLink' | 'usernoteRequirementOption'
>

/**
 * Builds a {@link SubUsernoteRequire} from a (possibly absent or partial) config,
 * applying the per-field defaults: type/link default off (absent/garbage -> false)
 * and text defaults on (only an explicit `false` disables it). This is the single
 * source of truth for reading the four require fields off a config object.
 * @param config The subreddit's toolbox config, or `undefined` if unavailable.
 * @returns The subreddit's requirement flags and enforcement mode.
 */
export function subUsernoteRequireFromConfig (config: RequireConfig | undefined,): SubUsernoteRequire {
	return {
		type: !!config?.requireUsernoteType,
		text: config?.requireUsernoteText !== false,
		link: !!config?.requireUsernoteLink,
		mode: config?.usernoteRequirementOption,
	}
}

/**
 * Combines a subreddit's requirement flags with a moderator's personal flags
 * into the effective requirements, applying the "more restrictive wins" rule.
 * @param subRequirements The subreddit's requirement flags and enforcement mode.
 * @param personal The acting moderator's personal requirement flags.
 * @returns The effective per-field requirements to enforce when saving a note.
 */
export function resolveUsernoteRequirements (
	subRequirements: SubUsernoteRequire,
	personal: UsernoteRequireFlags,
): UsernoteRequireFlags {
	// Only 'suggest' and 'force' let the subreddit flags participate; every other
	// value defers entirely to the moderator's personal settings.
	const subApplies = subRequirements.mode === 'suggest' || subRequirements.mode === 'force'
	return {
		type: personal.type || (subApplies && subRequirements.type),
		text: personal.text || (subApplies && subRequirements.text),
		link: personal.link || (subApplies && subRequirements.link),
	}
}

/** A draft note's current contents, used to check it against the requirements. */
export interface UsernoteDraftState {
	/** Whether the note body currently has non-whitespace text. */
	hasText: boolean
	/** Whether a note type/tag is currently selected. */
	hasType: boolean
	/** Whether a link is currently attached/included. */
	hasLink: boolean
	/**
	 * Whether a link requirement is even enforceable in this context - false in
	 * edit mode or when no linkable item exists, where the user cannot attach one.
	 */
	linkEnforceable: boolean
}

/**
 * Checks a draft note against the effective requirements, returning a
 * user-facing message for the first unmet requirement, or `null` when every
 * requirement is satisfied. Both the Save-button disabled state and the
 * save handler share this so they can never disagree.
 * @param require The effective per-field requirements to enforce.
 * @param draft The draft note's current contents.
 * @returns The message for the first unmet requirement, or `null` if all met.
 */
export function unmetUsernoteRequirement (
	require: UsernoteRequireFlags,
	draft: UsernoteDraftState,
): string | null {
	if (require.text && !draft.hasText) {
		return 'Note text is required for this subreddit'
	}
	if (require.type && !draft.hasType) {
		return 'A note type is required for this subreddit'
	}
	if (require.link && draft.linkEnforceable && !draft.hasLink) {
		return 'A link is required for this subreddit'
	}
	return null
}
