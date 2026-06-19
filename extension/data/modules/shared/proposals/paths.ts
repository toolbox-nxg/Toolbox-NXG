/**
 * Wiki path for the proposals page. Proposals are an NXG-only feature with no
 * legacy 6.x mirror, so they use a dedicated fixed path rather than the
 * layout-aware `getWikiWritePaths` (which fans out to legacy pages) and do not
 * touch the closed `WikiPageName` union in `wikiConstants.ts`.
 */

/** The single NXG wiki page holding a subreddit's proposals. */
const PROPOSALS_PAGE = 'toolbox-nxg/proposals'

/**
 * Returns the wiki page path for a subreddit's proposals. Takes no subreddit
 * argument because the path is the same in every subreddit (the subreddit scopes
 * the wiki, not the page name); it is a function to leave room for a future
 * bucketed layout (`toolbox-nxg/proposals/<bucket>`) without changing callers.
 */
export function getProposalsPagePath (): string {
	return PROPOSALS_PAGE
}
