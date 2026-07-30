/** DOM manipulation and event handlers for the removal reasons module, including button injection and overlay orchestration. */

import {useEffect, useState,} from 'react'
import {getSubredditAbout, getSubredditRules,} from '../../api/resources/subreddits'
import {
	getNativeRemoveButton as getNativeRemoveButtonOld,
	getThingFromDescendant as getThingOld,
} from '../../dom/oldReddit/things'
import {
	getNativeRemoveButton as getNativeRemoveButtonShreddit,
	getThingContext,
	getThingFromDescendant as getThingShreddit,
	stripSubredditPrefix,
} from '../../dom/shreddit/things'
import {provideLocation, renderAtLocation,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import {usernotes,} from '../../framework/moduleIds'
import {FlatListAction,} from '../../shared/controls/FlatListAction'
import {negativeTextFeedback,} from '../../store/feedback'
import {htmlEncode,} from '../../util/data/encoding'
import {selectorOptionKey,} from '../../util/data/string'
import createLogger from '../../util/infra/logging'
import {isOldReddit, RedditPlatform,} from '../../util/infra/platform'
import {getModuleSettingAsync,} from '../../util/persistence/settings'
import {pageDetails, postSite,} from '../../util/reddit/pageContext'
import type {ThingInfo,} from '../../util/reddit/thingInfo'
import {getApiThingInfo,} from '../../util/reddit/thingInfo'
import {getConfig,} from '../config/moduleapi'
import {proposeOrRemove,} from '../shared/proposals/gateway'
import {resolveUsernoteRequirements, subUsernoteRequireFromConfig,} from '../shared/usernotes/requireRules'
import {MountEffect,} from './components/MountEffect'
import {
	type RemovalAcceptGate,
	type RemovalReasonsOverlayPreseed,
	showRemovalReasonsOverlay,
} from './components/RemovalReasonsOverlay'
import {syncNativeReasons,} from './features/syncNativeReasons'
import {getNativeReasons, getRemovalReasons,} from './moduleapi'
import {setRemovalOverlayOpener,} from './overlayOpener'
import {
	defaultLogTitle,
	defaultSubject,
	isDrawerDisplayMode,
	type NoteDestination,
	RemovalReason,
	type RemovalReasonsConfig,
	type RemovalReasonsData,
	type RemovalReasonsOverlaySettings,
} from './schema'
import {RemovalReasonsSettings,} from './settings'
import {extractReportReasons, matchSuggestedReasons,} from './suggested'

const log = createLogger('RReasons',)

/** The thing-derived half of {@link RemovalReasonsData}, before config fields are merged. */
type OverlayBaseData = Pick<
	RemovalReasonsData,
	| 'subreddit'
	| 'fullname'
	| 'id'
	| 'author'
	| 'title'
	| 'kind'
	| 'mod'
	| 'url'
	| 'link'
	| 'domain'
	| 'body'
	| 'raw_body'
	| 'uri_body'
	| 'uri_title'
>

/**
 * Merges fetched thing data with a subreddit's removal-reasons config into the overlay's
 * `RemovalReasonsData`. Preserves each reason's persistent `id` (needed to round-trip a
 * proposal's selection back into the overlay on Edit & Accept).
 * @param baseData The thing-derived fields.
 * @param response The subreddit's removal-reasons config.
 */
function buildOverlayData (baseData: OverlayBaseData, response: RemovalReasonsConfig,): RemovalReasonsData {
	return {
		...baseData,
		subject: htmlEncode(response.pmsubject ?? '',) || defaultSubject,
		logReason: htmlEncode(response.logreason ?? '',) || '',
		header: response.header ? htmlEncode(response.header,) : '',
		footer: response.footer ? htmlEncode(response.footer,) : '',
		logSub: htmlEncode(response.logsub ?? '',) || '',
		logTitle: htmlEncode(response.logtitle ?? '',) || defaultLogTitle,
		removalOption: response.removalOption ?? '',
		typeReply: response.typeReply ?? '',
		typeStickied: response.typeStickied ?? false,
		typeCommentAsSubreddit: response.typeCommentAsSubreddit ?? false,
		typeLockComment: response.typeLockComment ?? false,
		typeAsSub: response.typeAsSub ?? false,
		autoArchive: response.autoArchive ?? false,
		typeLockThread: response.typeLockThread ?? false,
		editableReasonsEnabled: !!response.editableReasonsEnabled,
		reasons: response.reasons.map((r,) => ({
			// Preserve the persistent id so a captured selection can be re-seeded by id.
			...(r.id ? {id: r.id,} : {}),
			text: r.text,
			title: htmlEncode(r.title,),
			removePosts: r.removePosts === undefined ? undefined : !!r.removePosts,
			removeComments: r.removeComments === undefined ? undefined : !!r.removeComments,
			flairText: htmlEncode(r.flairText,),
			flairCSS: htmlEncode(r.flairCSS,),
			flairTemplateID: r.flairTemplateID === undefined ? '' : r.flairTemplateID,
			editable: r.editable === true,
			...(r.default_note ? {default_note: r.default_note,} : {}),
			...(r.default_note_type ? {default_note_type: r.default_note_type,} : {}),
			...(r.nativeReasonId ? {nativeReasonId: r.nativeReasonId,} : {}),
		})) as RemovalReason[],
	}
}

/**
 * Fills in the subreddit metadata behind Reddit's `{community_*}` macros, in place, but only
 * when one of the reasons on offer actually uses them.
 *
 * The `{community_rule_N}` macros are positional, so a rule is rendered the way Reddit renders
 * it - short name, then description - and the list order is Reddit's own.
 * @param data The overlay data to populate.
 * @param reasons The reasons the moderator will be choosing from.
 */
async function attachCommunityMacroData (data: RemovalReasonsData, reasons: RemovalReason[],): Promise<void> {
	const text = reasons.map((reason,) => reason.text).join('\n',)
	const needsAbout = text.includes('{community_name}',) || text.includes('{community_description}',)
	const needsRules = text.includes('{community_rule_',)
	if (!needsAbout && !needsRules) { return }

	const [about, rules,] = await Promise.all([
		needsAbout ? getSubredditAbout(data.subreddit,).catch(() => undefined) : undefined,
		needsRules ? getSubredditRules(data.subreddit,).catch(() => undefined) : undefined,
	],)
	if (about) {
		data.communityTitle = about.title
		data.communityDescription = about.publicDescription
	}
	if (rules) {
		data.communityRules = rules.map((
			rule,
		) => (rule.description ? `${rule.shortName} - ${rule.description}` : rule.shortName))
	}
}

/**
 * Filters the configured reasons down to those applicable to the target kind. Also decides
 * whether the "Add removal reason" control renders for a subreddit with reasons configured: when
 * this comes back empty there is nothing for the overlay to offer, so the control would be dead
 * (see {@link createRemovalReasonsHandlers}'s `hasVisibleReasons`, which handles the fallbacks
 * that apply when nothing is configured).
 * @param reasons All configured reasons.
 * @param isComment Whether the target is a comment.
 * @param commentReasons Whether the "removal reasons for comments" setting is on (only
 *   reasons explicitly flagged for comments show when off).
 */
function selectVisibleReasons (
	reasons: RemovalReason[],
	isComment: boolean,
	commentReasons: boolean,
): RemovalReason[] {
	if (!isComment) {
		return reasons.filter((r,) => r.removePosts || r.removePosts === undefined)
	}
	let visible = reasons.filter((r,) => r.removeComments || r.removeComments === undefined)
	if (!commentReasons) {
		visible = visible.filter((r,) => r.removeComments)
	}
	return visible
}

/** Props for {@link AddRemovalReasonAction}. */
interface AddRemovalReasonActionProps {
	/** Fullname of the removed thing the control acts on. */
	thingId: string
	/** Bare subreddit name the thing belongs to. */
	subreddit: string
	/** Whether the thing is a comment (decides which reasons would be offered). */
	isComment: boolean
	/** Resolves whether any configured reason applies to this thing's kind. */
	hasReasons: (subreddit: string, isComment: boolean,) => Promise<boolean>
}

/**
 * The "Add removal reason" pill for an already-removed thing, rendered only once
 * {@link AddRemovalReasonActionProps.hasReasons} confirms the overlay would have something to
 * offer for this thing's kind - otherwise the control is dead (the overlay resolves no visible
 * reasons and closes without doing anything). The check reads the subreddit config, so it can
 * only be answered asynchronously; the pill appears when it resolves.
 *
 * The pill carries no `onClick`: the click is handled by the document-level capture handler,
 * which matches the `toolbox-add-removal-reason` class, opens the overlay, and stops the event
 * so it can't reach Shreddit's full-post overlay. Same contract as the Remove pill - so
 * {@link FlatListAction} leaves the event alone.
 */
function AddRemovalReasonAction ({thingId, subreddit, isComment, hasReasons,}: AddRemovalReasonActionProps,) {
	const [show, setShow,] = useState(false,)
	useEffect(() => {
		let active = true
		void hasReasons(subreddit, isComment,).then((has,) => {
			if (active) { setShow(has,) }
		},)
		return () => {
			active = false
		}
	}, [subreddit, isComment, hasReasons,],)
	if (!show) { return null }
	return (
		<FlatListAction className="toolbox-add-removal-reason" data-id={thingId} data-subreddit={subreddit}>
			Add removal reason
		</FlatListAction>
	)
}

/** Inert overlay delivery settings; every value is overridden by a proposal pre-seed. */
const inertOverlaySettings: RemovalReasonsOverlaySettings = {
	reasonTypeSetting: '',
	reasonAsSubSetting: false,
	reasonAutoArchiveSetting: false,
	reasonStickySetting: false,
	reasonCommentAsSubredditSetting: false,
	actionLockSetting: false,
	actionLockCommentSetting: false,
}

/**
 * Opens the removal-reasons overlay off-page to **accept-with-edit** a captured proposal:
 * re-fetches the thing + the subreddit's reasons, seeds the overlay from the proposal's
 * captured selection/usernote/ban/delivery, and performs the removal directly (passing an
 * `acceptGate` puts the overlay in direct-perform mode and prevents re-capturing it).
 * `onAccepted` fires after a successful removal so the caller can mark the proposal accepted.
 * @returns `{ok:true, close}` when the overlay opened, or a typed failure.
 */
export async function openRemovalOverlayForProposal ({
	subreddit,
	fullname,
	isComment,
	seededFromIntent,
	acceptGate,
	onAccepted,
}: {
	subreddit: string
	fullname: string
	isComment: boolean
	seededFromIntent: RemovalReasonsOverlayPreseed
	/** Claim/release gate placing the overlay in direct-perform mode (see the overlay prop). */
	acceptGate?: RemovalAcceptGate
	onAccepted: () => void
},): Promise<{ok: true; close: () => void} | {ok: false; reason: 'no-reasons' | 'error'}> {
	let info: ThingInfo
	try {
		info = await getApiThingInfo(subreddit, fullname, false,)
	} catch (error) {
		log.error(`Unable to fetch removal context for proposal ${fullname}:`, error,)
		return {ok: false, reason: 'error',}
	}
	const response = await getRemovalReasons(subreddit,)
	if (!response || response.reasons.length < 1) { return {ok: false, reason: 'no-reasons',} }

	const data = buildOverlayData({
		subreddit: info.subreddit,
		fullname: info.fullname,
		id: info.id,
		author: info.user,
		title: info.title,
		kind: info.kind,
		mod: info.mod,
		url: info.permalink,
		link: info.postlink,
		domain: info.domain,
		body: info.body,
		raw_body: info.raw_body,
		uri_body: info.uri_body || encodeURIComponent(info.body,),
		uri_title: info.uri_title || encodeURIComponent(info.title,),
	}, response,)
	// Permissive comment filter: the trainee already chose the reasons; show them all.
	const visibleReasons = selectVisibleReasons(data.reasons, isComment, true,)
	if (!visibleReasons.length) { return {ok: false, reason: 'no-reasons',} }

	const close = showRemovalReasonsOverlay({
		data,
		visibleReasons,
		settings: inertOverlaySettings,
		seededFromIntent,
		...(acceptGate ? {acceptGate,} : {}),
		onRemoved: onAccepted,
	},)
	return {ok: true, close,}
}

function isDeletedAuthor (author: string | undefined,) {
	return !author || author.toLowerCase() === '[deleted]'
}

/**
 * Best-effort canonical link to a thing for display in a captured proposal, so a
 * reviewer can see what a silent removal targets. Posts get a precise comments URL
 * from their base-36 id; a bare comment fullname (no known parent) gets none.
 * @param subreddit The thing's subreddit.
 * @param fullname The thing's fullname (e.g. `t3_abc`).
 */
function buildItemLink (subreddit: string, fullname: string,): string | undefined {
	if (fullname.startsWith('t3_',)) {
		return `https://www.reddit.com/r/${subreddit}/comments/${fullname.slice(3,)}/`
	}
	return undefined
}

/**
 * Apply Toolbox's post-removal visual feedback in the light DOM: swap any prior action highlight
 * on the thing for the red `spammed` highlight, and relabel the toolbox remove button to "removed".
 * Old Reddit is the only place the thing gets painted (new Reddit has no `.thing` to highlight), but
 * the button relabel works everywhere. Used by the quick shift-click removal paths that bypass the
 * overlay; the overlay path applies its own richer feedback in {@link onRemoved}.
 *
 * @param thing The removed thing element, or null when it can't be resolved (e.g. new Reddit).
 * @param button The toolbox remove button to relabel, or null to leave the button untouched
 *   (e.g. native Old Reddit toggle buttons that manage their own label).
 * @param label The text to write into the button - "removed" for a plain removal, "spammed" when
 *   the action removed as spam. Defaults to "removed".
 */
function markRemovedFeedback (thing: HTMLElement | null, button: HTMLElement | null, label = 'removed',) {
	if (thing) {
		thing.classList.remove('flaired', 'removed', 'approved',)
		thing.classList.add('spammed',)
	}
	if (button) {
		button.textContent = label
	}
}

/** Event handler callbacks returned by {@link createRemovalReasonsHandlers}. */
export interface RemovalReasonsHandlers {
	/** Handles document-level click events that may open the removal reasons overlay. */
	handleClick: (event: MouseEvent,) => Promise<void>
	/** Disposes the renderers registered by this factory. Pass to `lifecycle.mount` in `index.ts`. */
	cleanup: () => Promise<void>
}

interface OpenOverlay {
	close: () => void
	resetRemoveButton: () => void
}

function provideRemovalReasonRemoveButtonSlot (
	target: Element,
	thingId: string,
	subredditName: string,
	hostTag: 'span' | 'li',
	bigModButton = false,
) {
	const slot = document.createElement(hostTag,)
	slot.className = 'toolbox-removal-reason-remove-slot'
	target.insertAdjacentElement('afterend', slot,)
	const cleanup = provideLocation('thingNativeActionReplacement', slot, {
		platform: RedditPlatform.Old,
		kind: 'thingNativeAction',
		thingId,
		rawDetail: {
			type: 'removalReasonRemoveButton',
			thingId,
			subredditName,
			// When replacing a `.big-mod-buttons` pretty-button (e.g. on reported items), the
			// button must be styled like its native spam/approve siblings; the renderer adds the
			// reddit pretty-button classes when this is set.
			bigModButton,
		},
	}, {shadow: false, hostTag,},)
	return () => {
		cleanup()
		slot.remove()
	}
}

/**
 * Hides the native Remove button for a thing and inserts a toolbox Remove button in its place.
 * Returns a cleanup function that removes the injected button and restores the native one.
 * @param thingId - Fullname of the thing (e.g. `t3_xxx`).
 * @param subredditName - Bare subreddit name (no `r/` prefix).
 * @param thingSlot - The thingActions slot element used to locate the thing in the DOM.
 */
export function injectRemoveButton (thingId: string, subredditName: string, thingSlot: Element,): () => void {
	if (!isOldReddit) {
		const thing = getThingShreddit(thingSlot,)
		if (!thing) { return () => {} }

		// When the thing has a flat-list mod-action row, the `thingFlatListActions` renderer
		// owns the Remove button (and groups the native Approve alongside it). Defer to it so
		// the two locations don't both inject a Remove. This path then only covers Shreddit
		// surfaces without that row (e.g. the profile-feed shadow-DOM posts).
		if (thing.querySelector('mod-content-actions[slot="mod-content-actions"]',)) { return () => {} }

		const native = getNativeRemoveButtonShreddit(thing,)
		if (!native) { return () => {} }
		if (
			native.nextElementSibling?.classList.contains('toolbox-removal-reason-remove',)
			|| native.nextElementSibling?.classList.contains('toolbox-removal-reason-remove-slot',)
		) { return () => {} }

		;(native as HTMLElement).style.setProperty('display', 'none', 'important',)

		const cleanupSlot = provideRemovalReasonRemoveButtonSlot(native, thingId, subredditName, 'span',)
		return () => {
			cleanupSlot()
			;(native as HTMLElement).style.removeProperty('display',)
		}
	}

	const thing = getThingOld(thingSlot,) as HTMLElement | null
	const nativeRemoveButton = thing ? getNativeRemoveButtonOld(thing,) : null
	if (!thing || !nativeRemoveButton) { return () => {} }

	if (nativeRemoveButton.matches('.big-mod-buttons > span > .pretty-button.neutral',)) {
		if (
			nativeRemoveButton.nextElementSibling?.classList.contains('toolbox-removal-reason-remove',)
			|| nativeRemoveButton.nextElementSibling?.classList.contains('toolbox-removal-reason-remove-slot',)
		) { return () => {} }

		nativeRemoveButton.hidden = true
		nativeRemoveButton.style.setProperty('display', 'none', 'important',)

		const hostTag = nativeRemoveButton.closest('li',) ? 'li' : 'span'
		const cleanupSlot = provideRemovalReasonRemoveButtonSlot(
			nativeRemoveButton,
			thingId,
			subredditName,
			hostTag,
			true,
		)
		return () => {
			cleanupSlot()
			nativeRemoveButton.hidden = false
			nativeRemoveButton.style.removeProperty('display',)
		}
	}

	const insertionPoint = nativeRemoveButton.closest('li',) ?? nativeRemoveButton
	if (
		insertionPoint.nextElementSibling?.classList.contains('toolbox-removal-reason-remove-item',)
		|| insertionPoint.nextElementSibling?.classList.contains('toolbox-removal-reason-remove-slot',)
	) { return () => {} }

	const hostTag = insertionPoint.tagName === 'LI' ? 'li' : 'span'
	const cleanupSlot = provideRemovalReasonRemoveButtonSlot(insertionPoint, thingId, subredditName, hostTag,)

	insertionPoint.hidden = true
	insertionPoint.style.setProperty('display', 'none', 'important',)
	return () => {
		cleanupSlot()
		insertionPoint.hidden = false
		insertionPoint.style.removeProperty('display',)
	}
}

/**
 * Creates the DOM handlers for the removal reasons module.
 * Injects toolbox Remove buttons, registers an "Add removal reason" action link,
 * and opens the removal overlay when a remove action is triggered.
 */
export function createRemovalReasonsHandlers ({
	alwaysShow,
	nativeReasonsFallback,
	commentReasons,
	customRemovalReason,
	displayMode,
	silentRemoveDeletedUsers,
	reasonType: reasonTypeSetting,
	reasonAsSub: reasonAsSubSetting,
	reasonAutoArchive: reasonAutoArchiveSetting,
	reasonSticky: reasonStickySetting,
	reasonCommentAsSubreddit: reasonCommentAsSubredditSetting,
	actionLock: actionLockSetting,
	actionLockComment: actionLockCommentSetting,
	disableRemoveButton,
	preselectSuggestedReasons,
}: RemovalReasonsSettings,): RemovalReasonsHandlers {
	const lifecycle = createLifecycle()
	const openOverlays = new Map<string, OpenOverlay>()
	let drawerOpenGeneration = 0

	async function openRemovalOverlay ({
		thingID,
		thingSubreddit,
		isComment,
		isAddRemovalReason,
		spam,
		pendingRemoveButton,
		thingElement,
	}: {
		thingID: string
		thingSubreddit: string
		isComment: boolean
		isAddRemovalReason: boolean
		/** Remove as spam (trains the spam filter) rather than a plain removal. */
		spam?: boolean
		pendingRemoveButton?: HTMLElement | null
		thingElement?: HTMLElement | null
	},) {
		const drawerMode = isDrawerDisplayMode(displayMode,)
		const originalRemoveButtonText = pendingRemoveButton?.textContent ?? ''
		const resetRemoveButton = () => {
			if (pendingRemoveButton && pendingRemoveButton.textContent === 'pending') {
				pendingRemoveButton.textContent = originalRemoveButtonText
			}
		}
		// The label is "remove" or, when the item has suggested reasons, "remove (suggestions)".
		const normalizedRemoveText = originalRemoveButtonText.trim().toLowerCase()
		if (
			pendingRemoveButton
			&& (normalizedRemoveText === 'remove' || normalizedRemoveText === 'remove (suggestions)')
		) {
			pendingRemoveButton.textContent = 'pending'
		}

		const continueRemovalWithoutOverlay = async (link?: string,) => {
			try {
				// Capture a link to the item so a reviewer can see what the silent
				// removal targets; fall back to a constructed post link when no precise
				// permalink was passed.
				const itemLink = link ?? buildItemLink(thingSubreddit, thingID,)
				await proposeOrRemove({
					subreddit: thingSubreddit,
					itemId: thingID,
					itemKind: isComment ? 'comment' : 'post',
					...(itemLink ? {link: itemLink,} : {}),
				}, spam ?? false,)
			} catch (error) {
				log.error(`Unable to continue removal for ${thingID}:`, error,)
			}
		}

		/**
		 * Exit taken when no reason would be shown for this item's kind. A Remove click still has to
		 * act, so it falls through to a plain removal. An "Add removal reason" click must not: the
		 * item is already removed, so removing it again would silently do nothing visible - tell the
		 * mod instead. This is also the only backstop for Reddit's own overflow-menu "Add removal
		 * reason" item, which Toolbox intercepts but cannot hide.
		 */
		const bailWithoutVisibleReasons = async (link?: string,) => {
			if (isAddRemovalReason) {
				negativeTextFeedback('No removal reasons apply to this item',)
			} else {
				await continueRemovalWithoutOverlay(link,)
			}
			resetRemoveButton()
		}

		const overlayKey = `${thingSubreddit}|${thingID}`
		const registryKey = drawerMode ? 'drawer' : overlayKey
		const existingOverlay = openOverlays.get(registryKey,)
		if (existingOverlay) {
			if (!drawerMode) {
				resetRemoveButton()
				return
			}
			existingOverlay.close()
		}
		const drawerGeneration = drawerMode ? ++drawerOpenGeneration : 0
		const drawerRequestIsCurrent = () => !drawerMode || drawerGeneration === drawerOpenGeneration

		let info: ThingInfo
		try {
			info = await getApiThingInfo(thingSubreddit, thingID, false,)
		} catch (error) {
			log.error(`Unable to fetch removal reason context for ${thingID}:`, error,)
			await continueRemovalWithoutOverlay()
			resetRemoveButton()
			return
		}
		if (!drawerRequestIsCurrent()) {
			resetRemoveButton()
			return
		}
		if (silentRemoveDeletedUsers && !isAddRemovalReason && isDeletedAuthor(info.user,)) {
			await continueRemovalWithoutOverlay(info.permalink,)
			resetRemoveButton()
			return
		}

		const baseData = {
			subreddit: info.subreddit,
			fullname: info.fullname,
			id: info.id,
			author: info.user,
			title: info.title,
			kind: info.kind,
			mod: info.mod,
			url: info.permalink,
			link: info.postlink,
			domain: info.domain,
			body: info.body,
			raw_body: info.raw_body,
			uri_body: info.uri_body || encodeURIComponent(info.body,),
			uri_title: info.uri_title || encodeURIComponent(info.title,),
		}

		let response = await getRemovalReasons(baseData.subreddit,)
		// Effective usernote save requirements: the acting subreddit's own config
		// flags (not any `getfrom` source; the getConfig read is cached from the
		// getRemovalReasons call above) combined with the moderator's personal
		// settings, "more restrictive wins".
		const [
			reqConfig,
			personalRequireType,
			personalRequireText,
			personalRequireLink,
			defaultNotesTab,
		] = await Promise.all([
			getConfig(baseData.subreddit,).catch(() => undefined),
			getModuleSettingAsync<boolean>(usernotes, 'requireNoteType', false,),
			getModuleSettingAsync<boolean>(usernotes, 'requireNoteText', true,),
			getModuleSettingAsync<boolean>(usernotes, 'requireNoteLink', false,),
			getModuleSettingAsync<string>(usernotes, 'defaultNotesTab', 'toolbox_notes',),
		],)
		const usernoteRequire = resolveUsernoteRequirements(
			subUsernoteRequireFromConfig(reqConfig,),
			{type: !!personalRequireType, text: !!personalRequireText, link: !!personalRequireLink,},
		)
		// A moderator who opens the notes popup on Native Notes works in Reddit's mod
		// notes, so default the removal note to the same place. Still overridable per
		// removal by the destination selector. Normalized through `selectorOptionKey`
		// because a selector setting is stored either as the derived key or as the raw
		// display label ("Native Notes"), and both are valid on read.
		const defaultNoteDestination: NoteDestination = selectorOptionKey(defaultNotesTab,) === 'native_notes'
			? 'native'
			: 'toolbox'
		if (!drawerRequestIsCurrent()) {
			resetRemoveButton()
			return
		}

		let nativeMode = false
		if (!response || response.reasons.length < 1) {
			// No Toolbox reasons configured: fall back to Reddit's native removal reasons
			// (either/or, never both, which sidesteps mixed selection). This branch only runs
			// where the overlay would otherwise bail, so subs with Toolbox reasons are untouched.
			const native = nativeReasonsFallback
				? await getNativeReasons(baseData.subreddit,).catch(() => [])
				: []
			if (!drawerRequestIsCurrent()) {
				resetRemoveButton()
				return
			}
			if (native.length) {
				nativeMode = true
				// A subreddit can have a configured message template and no reasons to go with
				// it. Only the reason list is missing, so only the reason list is replaced: the
				// header, footer, modmail subject and removal-log settings carry over, and the
				// same native reason sends the same message whether or not the sub has opted
				// into syncing. The literals below are the defaults for a sub with no config at
				// all, which is the other way into this branch.
				response = {
					pmsubject: '',
					logreason: '',
					header: '',
					footer: '',
					logsub: '',
					logtitle: '',
					getfrom: '',
					...response,
					reasons: native.map((n,) => ({
						text: n.message,
						title: n.title,
						flairText: '',
						flairCSS: '',
						flairTemplateID: '',
						editable: false,
						nativeReasonId: n.id,
					})),
				}
			} else if (alwaysShow) {
				response = {
					pmsubject: '',
					logreason: '',
					header: '',
					footer: '',
					logsub: '',
					logtitle: '',
					getfrom: '',
					reasons: [{
						text: customRemovalReason,
						flairText: '',
						flairCSS: '',
						flairTemplateID: '',
						title: '',
					},],
				}
			} else {
				await bailWithoutVisibleReasons(baseData.url,)
				return
			}
		}

		const data = buildOverlayData(baseData, response,)
		// Native reasons aren't post/comment-scoped, so bypass the kind/comment-setting filter.
		const visibleReasons = nativeMode
			? data.reasons
			: selectVisibleReasons(data.reasons, isComment, commentReasons,)

		if (!visibleReasons.length) {
			await bailWithoutVisibleReasons(data.url,)
			return
		}

		// Reddit's community macros need subreddit metadata Toolbox does not otherwise read, so
		// fetch it only when a reason actually mentions one. Most removals reference none, and
		// two extra requests on every removal to serve a macro nobody used is not a trade worth
		// making. Failures are swallowed: the macros stay literal, which is the same as not
		// supporting them, and a removal must not be blocked on decorative text.
		await attachCommunityMacroData(data, visibleReasons,)

		// Pre-select reasons suggested by the item's report (AutoMod/other bot/mod reports), unless the
		// mod has opted out. Several open paths (the cross-module opener, some old-Reddit/Shreddit button
		// routes) don't pass the thing element, so fall back to locating it by fullname - old Reddit tags
		// `.thing` with `data-fullname`, Shreddit tags `shreddit-post` with `id` - same as `onRemoved`.
		const reportSource = thingElement
			?? document.querySelector<HTMLElement>(`[data-fullname="${thingID}"]`,)
			?? document.querySelector<HTMLElement>(`shreddit-post[id="${thingID}"]`,)
		const suggestedReasonIds = preselectSuggestedReasons
			? matchSuggestedReasons(extractReportReasons(reportSource,), response.suggestedReasons,)
			: []

		log.debug('Showing removal reasons overlay',)
		const previousBodyOverflow = document.body.style.overflow
		if (!drawerMode) {
			document.body.style.overflow = 'hidden'
		}
		const onRemoved = () => {
			// Prefer the directly-captured element; fall back to a fullname query for paths
			// where we didn't traverse to the thing (isToolboxRemove, shreddit shadow DOM, etc.)
			const thing = thingElement
				?? document.querySelector<HTMLElement>(`[data-fullname="${thingID}"]`,)
			let resSelected: HTMLElement | null = null
			if (thing) {
				markRemovedFeedback(thing, null,)
				resSelected = thing.classList.contains('res-selected',)
					? thing
					: thing.querySelector<HTMLElement>('.res-selected',)
				if (resSelected) {
					resSelected.style.background = 'rgb(220 50 50 / 20%)'
				}
			}
			if (pendingRemoveButton) {
				pendingRemoveButton.textContent = 'removed'
				// Disabling the remove button is opt-in (off by default) so mods can still re-click it.
				// When disabled, dim it heavily; when still enabled, just slightly darken its colour.
				if (disableRemoveButton) {
					pendingRemoveButton.style.opacity = '0.5'
					if (pendingRemoveButton instanceof HTMLButtonElement) {
						pendingRemoveButton.disabled = true
					} else {
						pendingRemoveButton.style.pointerEvents = 'none'
						pendingRemoveButton.style.cursor = 'default'
					}
				} else {
					pendingRemoveButton.style.filter = 'brightness(0.85)'
				}
			}
			// Watch for the thing being approved so the button can be re-enabled.
			// Observing through the factory scope guarantees the observer also
			// disconnects at module cleanup when the thing is never un-removed.
			if (thing && pendingRemoveButton) {
				const stopObserving = lifecycle.observe(thing, () => {
					if (!thing.classList.contains('spammed',)) {
						void stopObserving()
						pendingRemoveButton.textContent = originalRemoveButtonText
						pendingRemoveButton.style.opacity = ''
						pendingRemoveButton.style.filter = ''
						if (disableRemoveButton) {
							if (pendingRemoveButton instanceof HTMLButtonElement) {
								pendingRemoveButton.disabled = false
							} else {
								pendingRemoveButton.style.pointerEvents = ''
								pendingRemoveButton.style.cursor = ''
							}
						}
						if (resSelected) {
							resSelected.style.background = ''
						}
					}
				}, {attributes: true, attributeFilter: ['class',],},)
			}
		}

		const close = showRemovalReasonsOverlay({
			data,
			...(spam ? {spam,} : {}),
			visibleReasons,
			...(nativeMode ? {nativeMode,} : {}),
			...(suggestedReasonIds.length ? {suggestedReasonIds,} : {}),
			displayMode,
			settings: {
				reasonTypeSetting,
				reasonAsSubSetting,
				reasonAutoArchiveSetting,
				reasonStickySetting,
				reasonCommentAsSubredditSetting,
				actionLockSetting,
				actionLockCommentSetting,
			},
			usernoteRequire,
			defaultNoteDestination,
			onRemoved,
			onClose: () => {
				if (!drawerMode) {
					document.body.style.overflow = previousBodyOverflow
				}
				resetRemoveButton()
				openOverlays.delete(registryKey,)
			},
		},)
		openOverlays.set(registryKey, {close, resetRemoveButton,},)

		// Refresh this subreddit's synced native reasons in the background, once the overlay is
		// already up. Deliberately not awaited: a removal click must not wait on a network round
		// trip, and any drift lands in the config for the next open rather than re-rendering
		// under the moderator. Because it touches no UI, it needs no staleness re-check.
		if (reqConfig?.removalReasons?.nativeSync?.enabled && !reqConfig.removalReasons.getfrom) {
			void syncNativeReasons(baseData.subreddit,).catch(() => {},)
		}
	}

	// Expose the overlay opener to other modules (e.g. the ModActions "Spam" button, which opens
	// the removal overlay flagged as spam) without them importing removalreasons internals.
	setRemovalOverlayOpener((options,) => {
		void openRemovalOverlay({
			thingID: options.thingID,
			thingSubreddit: options.thingSubreddit,
			isComment: options.isComment,
			isAddRemovalReason: false,
			...(options.spam ? {spam: options.spam,} : {}),
		},)
	},)
	lifecycle.mount(() => setRemovalOverlayOpener(null,))

	/**
	 * Resolves whether a queue item has at least one applicable suggested removal reason, using the
	 * same matching the overlay's pre-select uses (report match + visibility for the item's kind), so
	 * the remove button only advertises "(suggestions)" when reasons would actually be pre-selected.
	 */
	async function hasVisibleSuggestedReasons (subreddit: string, thingId: string,): Promise<boolean> {
		if (!preselectSuggestedReasons) { return false }
		const response = await getRemovalReasons(subreddit,).catch(() => undefined)
		if (!response || !response.suggestedReasons?.length) { return false }
		const reportSource = document.querySelector<HTMLElement>(`[data-fullname="${thingId}"]`,)
			?? document.querySelector<HTMLElement>(`shreddit-post[id="${thingId}"]`,)
		const matchedIds = matchSuggestedReasons(extractReportReasons(reportSource,), response.suggestedReasons,)
		if (!matchedIds.length) { return false }
		const visibleIds = new Set(
			selectVisibleReasons(response.reasons, thingId.startsWith('t1_',), commentReasons,)
				.map((reason,) => reason.id)
				.filter((id,): id is string => !!id),
		)
		return matchedIds.some((id,) => visibleIds.has(id,))
	}

	/**
	 * Resolves whether the overlay would offer at least one reason for an item of this kind,
	 * mirroring the resolution {@link openRemovalOverlay} does: with reasons configured the
	 * per-kind filter decides, and without them the fallbacks run in the same order the overlay
	 * tries them - Reddit's own reasons first, then the single custom reason when `alwaysShow` is
	 * on. The config read behind `getRemovalReasons` is cached, as is the native reason list, so
	 * this costs one cached read per thing.
	 */
	async function hasVisibleReasons (subreddit: string, isComment: boolean,): Promise<boolean> {
		const response = await getRemovalReasons(subreddit,).catch(() => false as const)
		const configured = response ? response.reasons : []
		if (configured.length > 0) {
			return selectVisibleReasons(configured, isComment, commentReasons,).length > 0
		}
		if (nativeReasonsFallback) {
			// Native reasons aren't post/comment-scoped, so the overlay shows all of them for
			// either kind - having any at all is enough for the control to do something.
			const native = await getNativeReasons(subreddit,).catch(() => [])
			if (native.length) { return true }
		}
		if (!alwaysShow) { return false }
		const custom = [{text: customRemovalReason, title: '', flairText: '', flairCSS: '', flairTemplateID: '',},]
		return selectVisibleReasons(custom, isComment, commentReasons,).length > 0
	}

	renderAtLocation(
		'thingNativeActionReplacement',
		{id: 'removalreasons.nativeRemoveButton', lifecycle,},
		({context,},) => {
			const detail = context.rawDetail as
				| {type: string; thingId: string; subredditName: string; bigModButton?: boolean}
				| undefined
			if (detail?.type !== 'removalReasonRemoveButton') { return null }
			// On reported items the native remove lives among `.big-mod-buttons` pretty-buttons, so
			// match the native `pretty-button ... neutral` styling of its spam/approve siblings. The
			// `toolbox-removal-reason-remove` class is always kept so the click handler still routes
			// through the removal-reasons overlay.
			const className = detail.bigModButton
				? 'toolbox-removal-reason-remove pretty-button access-required neutral'
				: 'toolbox-removal-reason-remove'
			// Render "remove" immediately, then relabel to "remove (suggestions)" once the async
			// match resolves - done via a ref (not React state) so the label survives the imperative
			// textContent swaps the click handler does ("pending"/"removed") without a competing render.
			const markSuggestions = (el: HTMLAnchorElement | null,) => {
				if (!el) { return }
				void hasVisibleSuggestedReasons(detail.subredditName, detail.thingId,).then((has,) => {
					if (has && el.textContent === 'remove') { el.textContent = 'remove (suggestions)' }
				},)
			}
			return (
				<a
					ref={markSuggestions}
					className={className}
					data-id={detail.thingId}
					data-subreddit={detail.subredditName}
				>
					remove
				</a>
			)
		},
	)

	renderAtLocation('thingActions', {id: 'removalreasons.remove', lifecycle,}, ({context, target,},) => {
		// Already-removed items normally surface "Add removal reason" (the flat-list action below)
		// rather than Remove. But that action is suppressed on the modqueue, so an AutoMod-filtered
		// (already removed) queue item would otherwise get no Toolbox removal control at all - leaving
		// the mod unable to re-remove it with a reason. Keep injecting Remove for removed items on the
		// queue; off-queue, a removed item still falls through to the Add-removal-reason action.
		if (context.isRemoved && pageDetails.pageType !== 'queueListing') { return null }
		const {thingId, subreddit,} = context
		if (!thingId || !subreddit) { return null }
		return <MountEffect effect={() => injectRemoveButton(thingId, subreddit, target,)} />
	},)

	// The Shreddit flat-list Toolbox Remove link is rendered by the ModActions row (so it sits
	// directly after Spam - the two removal actions grouped). It carries the
	// `toolbox-removal-reason-remove` class, so the document-level capture handler below still routes
	// its click to the overlay. Old Reddit's Remove is handled via `injectRemoveButton` (thingActions).

	// On Shreddit the "Add removal reason" control lives in the flat-list row (below), styled like
	// the other row buttons. Old Reddit's equivalent is handled by `injectRemoveButton`/thingActions
	// elsewhere; there's no separate Shreddit thingActions renderer (it would duplicate the row one).
	renderAtLocation('thingFlatListActions', {id: 'removalreasons.reason', lifecycle,}, ({context,},) => {
		if (!context.isRemoved) { return null }
		if (pageDetails.pageType === 'queueListing') { return null }
		const {thingId, subreddit,} = context
		if (!thingId || !subreddit) { return null }
		// The pill itself decides whether to render: it only appears once `hasVisibleReasons` says the
		// overlay would offer something for this kind. A comment on a sub whose reasons are all
		// post-only (the common case with "removal reasons for comments" off) gets nothing rather than
		// a control that opens an empty overlay.
		return (
			<AddRemovalReasonAction
				thingId={thingId}
				subreddit={subreddit}
				isComment={context.kind === 'comment'}
				hasReasons={hasVisibleReasons}
			/>
		)
	},)

	return {
		cleanup: lifecycle.cleanup,
		handleClick: async (event: MouseEvent,) => {
			// composedPath()[0] gives the real clicked element even when the event
			// originated inside a shadow DOM (where event.target is retargeted to the host).
			const eventTarget = (event.composedPath()[0] ?? event.target) as Element | null

			// Handle "Add Removal Reason" from shadow DOM inside unpacking-overflow-menu.
			// event.target is the shadow host; composedPath() exposes the real button.
			const shadowAddReasonBtn = event.composedPath().find(
				(el,): el is Element => el instanceof Element && el.matches('button[data-item-id="addRemovalReason"]',),
			) ?? null
			if (shadowAddReasonBtn) {
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation()
				const overflowMenu = event.composedPath().find(
					(el,): el is Element => el instanceof Element && el.matches('unpacking-overflow-menu',),
				) ?? null
				if (!overflowMenu) { return }
				const thingID = overflowMenu.getAttribute('post-id',)
				const thingSubreddit = stripSubredditPrefix(
					overflowMenu.getAttribute('subreddit-prefixed-name',) ?? '',
				)
				if (!thingID || !thingSubreddit) { return }
				await openRemovalOverlay({thingID, thingSubreddit, isComment: false, isAddRemovalReason: true,},)
				return
			}

			// Handle toolbox Remove button injected into shadow DOM (profile feed).
			// event.target is the shadow host; composedPath() exposes the actual button.
			const shadowToolboxRemoveBtn = event.composedPath().find(
				(el,): el is HTMLElement =>
					el instanceof HTMLElement && el.classList.contains('toolbox-removal-reason-remove',),
			) ?? null
			if (shadowToolboxRemoveBtn) {
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation()
				const thingID = shadowToolboxRemoveBtn.dataset.id
				const thingSubreddit = shadowToolboxRemoveBtn.dataset.subreddit
				if (!thingID || !thingSubreddit) { return }
				if (event.shiftKey) {
					const link = buildItemLink(thingSubreddit, thingID,)
					const outcome = await proposeOrRemove({
						subreddit: thingSubreddit,
						itemId: thingID,
						itemKind: thingID.startsWith('t1_',) ? 'comment' : 'post',
						...(link ? {link,} : {}),
					}, false,)
					// Only reflect a real removal; a captured proposal leaves the item untouched.
					// Profile-feed posts live in shadow DOM with no `.thing` to paint, so just relabel.
					if (outcome === 'performed') {
						markRemovedFeedback(null, shadowToolboxRemoveBtn,)
					}
					return
				}
				await openRemovalOverlay({
					thingID,
					thingSubreddit,
					isComment: thingID.startsWith('t1_',),
					isAddRemovalReason: false,
					pendingRemoveButton: shadowToolboxRemoveBtn,
				},)
				return
			}

			// Handle the Toolbox "Add removal reason" pill (inserted by the UILocations React renderer).
			// It carries no `onClick`, so this capture-phase handler is what runs it; stop the event the
			// same way the Remove branch above does, otherwise it would also reach Shreddit's full-post
			// overlay and navigate to the post.
			const addReasonEl = eventTarget?.closest<HTMLElement>('.toolbox-add-removal-reason',) ?? null
			if (addReasonEl) {
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation()
				const thingID = addReasonEl.dataset.id
				const thingSubreddit = addReasonEl.dataset.subreddit
				if (!thingID || !thingSubreddit) { return }
				const isComment = thingID.startsWith('t1_',)
				await openRemovalOverlay({thingID, thingSubreddit, isComment, isAddRemovalReason: true,},)
				return
			}

			const nonButtonSelectorNoAddReason =
				'.toolbox-removal-reason-remove, .big-mod-buttons > span > .pretty-button.neutral, .remove-button, .toolbox-submission-button-remove, .toolbox-comment-button-remove'
			let element = eventTarget?.closest(nonButtonSelectorNoAddReason,) ?? null
			if (!element) {
				const button = eventTarget?.closest('button',) ?? null
				if (
					button
					&& !(button.getRootNode() instanceof ShadowRoot)
					// Never swallow clicks on Toolbox's own React-rendered buttons (e.g. the mass-moderation
					// toolbar's "remove selected"/"removed selected") - this fallback exists to catch native
					// Reddit remove controls without a recognized class, not Toolbox's own UI.
					&& !button.closest('.toolbox-react-light-host',)
				) {
					const text = button.textContent ?? ''
					if (/\bremov(e|al)\b/i.test(text,)) {
						element = button
					}
				}
			}
			if (!element) { return }

			const isToolboxRemove = element.classList.contains('toolbox-removal-reason-remove',)
			if (event.shiftKey) {
				if (isToolboxRemove) {
					event.preventDefault()
					event.stopPropagation()
					event.stopImmediatePropagation()
					const thingID = (element as HTMLElement).dataset.id
					// Fall back to the current page's subreddit when the element doesn't carry
					// its own (single-sub pages); empty on multi-sub pages, handled below.
					const thingSubreddit = (element as HTMLElement).dataset.subreddit || postSite
					if (thingID && thingSubreddit) {
						const link = buildItemLink(thingSubreddit, thingID,)
						const outcome = await proposeOrRemove({
							subreddit: thingSubreddit,
							itemId: thingID,
							itemKind: thingID.startsWith('t1_',) ? 'comment' : 'post',
							...(link ? {link,} : {}),
						}, false,)
						// Only reflect a real removal; a captured proposal leaves the item untouched.
						// The toolbox button lives in the thing's light DOM on Old Reddit; relabel it and
						// paint the thing. On New Reddit the thing won't resolve, so only the button relabels.
						if (outcome === 'performed') {
							markRemovedFeedback(
								element.closest<HTMLElement>('[data-fullname]',),
								element as HTMLElement,
							)
						}
					} else if (thingID) {
						// We have the item but not its subreddit (and we're not on a single-sub
						// page), so we can't route the removal through the proposals gateway (it
						// needs the sub to decide capture). Tell the mod rather than silently doing
						// nothing - they expect a removal here.
						negativeTextFeedback('Couldn\'t determine this item\'s subreddit; it was not removed',)
					}
				} else if (isOldReddit) {
					event.preventDefault()
					event.stopPropagation()
					event.stopImmediatePropagation()
					const thing = getThingOld(element,) as HTMLElement | null
					const thingID = thing?.dataset.fullname
					// Fall back to the current page's subreddit when the thing doesn't carry one
					// (single-sub pages); empty on multi-sub pages, handled below.
					const thingSubreddit = thing?.dataset.subreddit || postSite
					if (thingID && thingSubreddit && thing) {
						// Old Reddit's spam button is also a `.remove-button` form, so it lands here too.
						// Route it as a spam removal (trains the filter) and label it "spammed" to match;
						// a plain remove stays a non-spam removal labelled "removed".
						const isSpamAction = !!element.querySelector('[data-event-action="spam"]',)
						const link = buildItemLink(thingSubreddit, thingID,)
						const outcome = await proposeOrRemove({
							subreddit: thingSubreddit,
							itemId: thingID,
							itemKind: thingID.startsWith('t1_',) ? 'comment' : 'post',
							...(link ? {link,} : {}),
						}, isSpamAction,)
						// Only reflect a real removal in the DOM; a captured proposal leaves the item
						// visually untouched (it wasn't actually removed). We swallowed the click above,
						// so Reddit's native toggle never runs - relabel the control ourselves. The
						// `.remove-button` form wraps a `.togglebutton`; otherwise relabel the element.
						if (outcome === 'performed') {
							const removeLabel = element.querySelector<HTMLElement>('.togglebutton',)
								?? (element instanceof HTMLElement ? element : null)
							markRemovedFeedback(thing, removeLabel, isSpamAction ? 'spammed' : 'removed',)
						}
					} else if (thingID) {
						// Item found but no subreddit to route the gateway removal through (and not
						// on a single-sub page); surface it instead of silently no-opping (the mod
						// expects the item to be removed).
						negativeTextFeedback('Couldn\'t determine this item\'s subreddit; it was not removed',)
					}
				}
				return
			}

			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()

			let thingID: string | undefined
			let thingSubreddit: string | undefined
			let isComment = false
			let thingElement: HTMLElement | null = null

			if (isOldReddit || element.matches('.toolbox-submission-button-remove, .toolbox-comment-button-remove',)) {
				let thing = (isOldReddit ? getThingOld(element,) : getThingShreddit(element,)) as HTMLElement | null
				if (!thing) {
					// Fallback: button may be inside a toolbox-rendered comment/submission (e.g. context popup)
					thing = element.closest<HTMLElement>('.toolbox-comment, .toolbox-submission',) ?? null
				}
				if (!thing) { return }
				thingElement = thing
				isComment = thing.classList.contains('comment',) || thing.classList.contains('was-comment',)
					|| thing.classList.contains('toolbox-comment',)
				thingID = thing.dataset.fullname
				thingSubreddit = thing.dataset.subreddit
			} else if (isToolboxRemove) {
				thingID = (element as HTMLElement).dataset.id
				thingSubreddit = (element as HTMLElement).dataset.subreddit
				isComment = thingID?.startsWith('t1_',) ?? false
				thingElement = element.closest<HTMLElement>('[data-fullname]',)
					?? element.parentElement
			} else {
				const thing = getThingShreddit(element,) as HTMLElement | null
				if (!thing) { return }
				thingElement = thing
				const context = getThingContext(thing,)
				if (!context) { return }
				thingID = context.thingId
				thingSubreddit = context.subreddit
				isComment = context.isComment
			}

			if (!thingID || !thingSubreddit) { return }

			const pendingRemoveButton = !element.classList.contains('remove-button',) && element instanceof HTMLElement
				? element
				: eventTarget?.closest<HTMLButtonElement>('button',) ?? null

			// Old Reddit's spam button is also a `.remove-button` form; flag the overlay as spam so the
			// removal trains the filter, matching what the native button would have done.
			const isSpamAction = !!element.querySelector('[data-event-action="spam"]',)

			await openRemovalOverlay({
				thingID,
				thingSubreddit,
				isComment,
				isAddRemovalReason: false,
				...(isSpamAction ? {spam: true,} : {}),
				pendingRemoveButton,
				thingElement,
			},)
		},
	}
}
