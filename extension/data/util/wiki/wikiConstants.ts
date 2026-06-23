/**
 * Pure constants and helpers for the toolbox wiki page namespace: the legacy
 * and NXG page paths plus the NXG layout metadata keys. This module has no
 * imports so any code (codecs, sharding, reconcilers) can depend on the path
 * names without pulling in the layout resolver in `wikiPaths.ts` - which
 * imports the migration machinery and would otherwise create import cycles.
 */

/** Logical names for the wiki pages toolbox manages. */
export type WikiPageName = 'settings' | 'usernotes' | 'notes' | 'userSettings'

/** Old (legacy) page paths, keyed by logical name. */
export const OLD_WIKI_PATHS: Record<WikiPageName, string> = {
	settings: 'toolbox',
	usernotes: 'usernotes',
	notes: 'notes/index',
	userSettings: 'tbsettings',
}

/** New centralized page paths, keyed by logical name. */
export const NEW_WIKI_PATHS: Record<WikiPageName, string> = {
	settings: 'toolbox-nxg',
	usernotes: 'toolbox-nxg/usernotes',
	notes: 'toolbox-nxg/notes',
	userSettings: 'toolbox-nxg/user-settings',
}

/**
 * The single canonical wiki page for NXG domain tags. Domain tags are NXG-only:
 * 6.x reads them from the main config page (re-injected via `encodeClassicConfig`
 * during the compatibility copy), not from a standalone page, so there is no
 * legacy mirror and this path must never be fanned out through the generic
 * write-path machinery.
 */
export const DOMAIN_TAGS_PAGE = 'toolbox-nxg/domain-tags'

/** Legacy wiki page prefix for individual subreddit note pages. */
export const OLD_NOTE_PAGE_PREFIX = 'notes/'

/** NXG wiki page prefix for individual subreddit note pages. */
export const NEW_NOTE_PAGE_PREFIX = 'toolbox-nxg/notes/'

/**
 * Config key marking a `toolbox` page as an NXG tombstone. Only written when
 * compatibility mode is turned off; its presence without a `toolbox-nxg` page
 * means the NXG pages were deleted externally.
 */
export const WIKI_LAYOUT_KEY = 'Toolbox.Utils.wikiLayout'

/**
 * Config key inside the `toolbox-nxg` page holding the per-subreddit
 * 6.x-compatibility flag. Written explicitly on every NXG config save.
 */
export const COMPAT_WRITES_KEY = 'Toolbox.Utils.compatibilityWrites'

/**
 * Returns a shallow copy of a config object without the NXG layout metadata
 * keys. Used when writing the legacy `toolbox` mirror, which 6.x parses.
 */
export function stripLayoutMetadata (config: object,): Record<string, unknown> {
	const copy: Record<string, unknown> = {...config,}
	delete copy[WIKI_LAYOUT_KEY]
	delete copy[COMPAT_WRITES_KEY]
	return copy
}

/** Returns `true` when a parsed `toolbox` page is an NXG tombstone rather than a real 6.x config. */
export function isTombstone (data: object,): boolean {
	return (data as Record<string, unknown>)[WIKI_LAYOUT_KEY] === 'nxg'
}
