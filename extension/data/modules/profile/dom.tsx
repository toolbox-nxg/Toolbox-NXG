/** DOM integration for the Profile module - creates event handlers and registers UI renderers. */
import {renderAtLocation,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import {removeContextItem,} from '../../store/contextMenu'
import {negativeTextFeedback,} from '../../store/feedback'
import {pageDetails, type TBPageContext,} from '../../util/reddit/pageContext'
import {navigateTo,} from '../../util/ui/navigation'

import {ProfileButtonUserRoot,} from './components/ProfileButtonUserRoot'
import {showProfileOverlay,} from './components/ProfileOverlay'
import {type ProfileListing,} from './components/ProfileOverlay.helpers'
import {type ProfileSettings,} from './settings'

declare global {
	interface WindowEventMap {
		TBHashParams: CustomEvent<Record<string, string>>
	}
}

const listingTypes = ['overview', 'submitted', 'comments',]

/** Options forwarded to the profile overlay when opened from a link, button, or hash parameter. */
interface ProfileOptions {
	/** Sort order to apply to the listing. */
	sort?: string
	/** Whether the sort was specified via hash params (used to avoid clobbering user selection). */
	searchSort?: boolean
	/** Whether to activate the search form on open. */
	search?: boolean
	/** Initial subreddit filter value. */
	subreddit?: string
	/** Initial content filter value. */
	content?: string
}

/** Event handler functions created by `createProfileHandlers` for use with lifecycle delegation. */
export interface ProfileHandlers {
	/** Intercepts profile link clicks to open the overlay instead of navigating. */
	handleLinkClick: (element: Element, event: MouseEvent,) => void
	/** Responds to page navigation events to auto-open the overlay when configured. */
	handleNewPage: (event: CustomEvent<TBPageContext>,) => void
	/** Handles clicks on `#toolbox-user-profile` elements embedded in the page. */
	handleProfileButtonClick: (element: Element,) => void
	/** Responds to `TBHashParams` events to open the overlay from URL hash parameters. */
	handleHashParams: (event: CustomEvent<Record<string, string>>,) => void
}

// sessionStorage key recording the user/listing the overlay was last auto-opened for.
// TBNewPage fires on every location.href change, and native Reddit pagination (`?count=`)
// performs a full page reload - both would otherwise resurrect an overlay the moderator
// closed. Persisting in sessionStorage (per-tab, same origin) lets the guard survive the
// reload so the overlay stays closed while paging through the same profile.
const AUTO_OPEN_KEY = 'tb-profile-last-auto-open'

/**
 * Reads a sessionStorage item, returning null if storage is unavailable (e.g. privacy mode).
 * All sessionStorage access in this module goes through these helpers so that callers never
 * touch sessionStorage directly and accidentally lose the graceful-degradation guarantee.
 * @param key The storage key to read.
 */
function safeSessionGet (key: string,): string | null {
	try {
		return sessionStorage.getItem(key,)
	} catch {
		return null
	}
}

/**
 * Writes or removes a sessionStorage item, silently ignoring errors when storage is unavailable.
 * @param key The storage key to write.
 * @param value The value to store, or null to remove the key.
 */
function safeSessionSet (key: string, value: string | null,): void {
	try {
		if (value === null) {
			sessionStorage.removeItem(key,)
		} else {
			sessionStorage.setItem(key, value,)
		}
	} catch {
		// sessionStorage unavailable (privacy mode) - degrade silently.
	}
}

/** Reads the last auto-opened profile key. */
function getLastAutoOpenedKey (): string | null {
	return safeSessionGet(AUTO_OPEN_KEY,)
}

/**
 * Records (or clears, when `key` is null) the last auto-opened profile key.
 * @param key The `user/listing` key just auto-opened, or null to clear on leaving a profile.
 */
function setLastAutoOpenedKey (key: string | null,) {
	safeSessionSet(AUTO_OPEN_KEY, key,)
}

/**
 * Creates the set of event handlers that drive the Profile module's behavior.
 * @param settings Current module settings.
 * @returns An object of handlers ready to be attached via lifecycle delegation.
 */
export function createProfileHandlers (
	{alwaysTbProfile, subredditColor,}: ProfileSettings,
): ProfileHandlers {
	function openProfile (user: string, listing: string, options: ProfileOptions = {},) {
		showProfileOverlay({
			user,
			initialListing: (listingTypes.includes(listing,) ? listing : 'overview') as ProfileListing,
			initialOptions: options,
			subredditColor,
		},)
	}

	function handleProfileButtonClick (element: Element,) {
		const htmlEl = element as HTMLElement
		const user = htmlEl.dataset.user
		const listing = htmlEl.dataset.listing
		if (!user || !listing) { return }
		const sub = htmlEl.dataset.subreddit
		const options: ProfileOptions = {sort: 'new',}
		if (sub) { options.subreddit = sub }
		openProfile(user, listing, options,)
	}

	return {
		handleLinkClick: (element, event,) => {
			const userProfileRegex = /(?:\.reddit\.com)?\/(?:user|u)\/[^/]*?\/?$/
			const thisHref = element.getAttribute('href',)
			if (thisHref && userProfileRegex.test(thisHref,) && !userProfileRegex.test(window.location.href,)) {
				event.preventDefault()
				const lastChar = thisHref.slice(-1,)
				const newHref = `${thisHref}${lastChar === '/' ? '' : '/'}overview`
				if (event.ctrlKey || event.metaKey) {
					window.open(newHref, '_blank',)
				} else {
					navigateTo(newHref,)
				}
			}
		},

		handleNewPage: (event,) => {
			removeContextItem('toolbox-user-profile',)
			const detail = event.detail
			const listing = detail.pageDetails.listing
			const user = detail.pageDetails.user
			if (detail.pageType !== 'userProfile') {
				// Left the profile page entirely; allow a future return to auto-open again.
				setLastAutoOpenedKey(null,)
				return
			}
			if (listing && user && listingTypes.includes(listing,)) {
				if (alwaysTbProfile && !detail.locationHref.includes('#?tbprofile',)) {
					// Skip reopening when the profile target is unchanged and only the URL moved
					// (RES NER `#res:ner-page=` hashes, native `?count=` pagination, etc.), which
					// would otherwise resurrect an overlay the moderator deliberately closed.
					const autoOpenKey = `${user}/${listing}`
					if (autoOpenKey !== getLastAutoOpenedKey()) {
						setLastAutoOpenedKey(autoOpenKey,)
						openProfile(user, listing, {sort: 'new',},)
					}
				}
			}
		},

		handleProfileButtonClick,

		handleHashParams: (event,) => {
			const detail = event.detail
			const listing = detail.tbprofile
			if (!listing || !listingTypes.includes(listing,)) { return }

			let user: string
			if (detail.user) {
				user = detail.user
			} else if (pageDetails.pageType === 'userProfile') {
				const profileUser = pageDetails.pageDetails.user
				if (!profileUser) { return }
				user = profileUser
			} else {
				negativeTextFeedback('No user present in parameters and not on profile page.',)
				return
			}

			const options: ProfileOptions = {searchSort: !!detail.sort, search: false,}
			if (detail.sort) { options.sort = detail.sort }
			if (detail.subreddit) {
				options.search = true
				options.subreddit = detail.subreddit
			}
			if (detail.content) {
				options.search = true
				options.content = detail.content
			}
			openProfile(user, listing, options,)
		},
	}
}

/**
 * Registers per-author profile buttons in the relevant UI locations.
 * @param subredditColor Whether to pass subreddit color accents into the opened overlay.
 * @returns A cleanup function to pass to `lifecycle.mount` in `index.ts`.
 */
export function registerProfileRenderers (subredditColor: boolean,) {
	const lifecycle = createLifecycle()
	renderAtLocation(
		'authorActions',
		{id: 'profile.author', order: 40, lifecycle,},
		({context, target,},) => {
			if (!context.author) { return null }
			if (target.closest('.toolbox-profile-overlay',) || target.closest('.toolbox-react-shadow-host',)) {
				return null
			}
			return (
				<ProfileButtonUserRoot
					user={context.author}
					subreddit={context.subreddit ?? ''}
					listing="overview"
					subredditColor={subredditColor}
					author
				/>
			)
		},
	)
	return lifecycle.cleanup
}
