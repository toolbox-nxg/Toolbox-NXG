/** DOM wiring for the Announcements module: the per-post composer button and the modbar manager button. */

import {useEffect, useState,} from 'react'

import {renderAtLocation,} from '../../dom/uiLocations'
import type {Lifecycle,} from '../../framework/lifecycle'
import {GeneralInlineButton,} from '../../shared/controls/GeneralInlineButton'
import {IsModGuard,} from '../../shared/controls/IsModGuard'
import {ModbarButton,} from '../../shared/controls/ModbarButton'
import {pageDetails, type TBPageContext,} from '../../util/reddit/pageContext'
import {mountPopup,} from '../../util/ui/reactMount'
import {openAnnouncementBuilder,} from './components/AnnouncementBuilderPopup'
import {AnnouncementManagerOverlay,} from './components/AnnouncementManagerOverlay'
import {ANNOUNCEMENTS_SUB,} from './constants'

/**
 * Normalizes a Reddit permalink (often root-relative like `/r/sub/comments/...`)
 * into an absolute URL suitable for storing in the wiki and opening anywhere.
 * @param permalink The permalink from the post's UI-location context.
 */
function toAbsoluteUrl (permalink: string | undefined,): string | undefined {
	if (!permalink) { return undefined }
	if (/^https?:\/\//.test(permalink,)) { return permalink }
	return `https://www.reddit.com${permalink.startsWith('/',) ? '' : '/'}${permalink}`
}

/** Mounts the manage-announcements overlay. Re-uses one instance via the popup key. */
function openManager () {
	mountPopup(
		(onClose,) => <AnnouncementManagerOverlay onClose={onClose} />,
		undefined,
		'announcement-manager',
	)
}

/**
 * Tracks the current page's subreddit, updating on Toolbox's `TBNewPage`
 * navigation events so modbar buttons can show/hide as the user moves around.
 */
function useCurrentSubreddit (): string | undefined {
	const [subreddit, setSubreddit,] = useState<string | undefined>(() =>
		pageDetails['subreddit'] as string | undefined
	)
	useEffect(() => {
		const handler = (event: CustomEvent<TBPageContext>,) => {
			setSubreddit(event.detail.pageDetails['subreddit'],)
		}
		window.addEventListener('TBNewPage', handler,)
		return () => window.removeEventListener('TBNewPage', handler,)
	}, [],)
	return subreddit
}

/**
 * Modbar entry that opens the manage-announcements overlay. Renders only while
 * the user is viewing {@link ANNOUNCEMENTS_SUB}; {@link IsModGuard} then hides it
 * unless they moderate the subreddit.
 */
function ManageAnnouncementsButton () {
	const subreddit = useCurrentSubreddit()
	if (subreddit?.toLowerCase() !== ANNOUNCEMENTS_SUB) {
		return null
	}
	return (
		<IsModGuard subreddit={ANNOUNCEMENTS_SUB}>
			<ModbarButton onClick={openManager}>Manage announcements</ModbarButton>
		</IsModGuard>
	)
}

/**
 * Registers the announcements UI for mods of {@link ANNOUNCEMENTS_SUB}:
 * - a per-post "Make Toolbox announcement" composer button, and
 * - a modbar "Manage announcements" button (list / remove / new).
 *
 * Both render only in the announcements subreddit (cheap synchronous checks);
 * {@link IsModGuard} then hides them unless the current user moderates it.
 * @param lifecycle The module lifecycle; renderers are unregistered on cleanup.
 */
export function setupAnnouncementBuilder (lifecycle: Lifecycle,) {
	renderAtLocation('thingFlatListActions', {id: 'announcementBuilder.add', lifecycle, order: 50,}, ({context,},) => {
		if (context.kind !== 'post') { return null }
		if (context.subreddit !== ANNOUNCEMENTS_SUB) { return null }
		const postLink = toAbsoluteUrl(context.permalink,)
		return (
			<IsModGuard subreddit={ANNOUNCEMENTS_SUB}>
				<GeneralInlineButton onClick={() => openAnnouncementBuilder({postLink,},)}>
					Make Toolbox announcement
				</GeneralInlineButton>
			</IsModGuard>
		)
	},)

	renderAtLocation('modbar', {id: 'announcements.manage', lifecycle, order: 5,}, () => <ManageAnnouncementsButton />,)
}
