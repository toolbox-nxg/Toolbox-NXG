/** DOM helpers for bootstrapping the Mod Log Matrix popup, including subreddit data extraction from both old Reddit and Shreddit. */

import {type ReactElement,} from 'react'
import {Provider,} from 'react-redux'
import browser from 'webextension-polyfill'

import {getMenuarea,} from '../../dom/oldReddit/page'
import {provideLocation,} from '../../dom/uiLocations'
import {ActionButton,} from '../../shared/controls/ActionButton'
import {Backdrop,} from '../../shared/window/Backdrop'
import store from '../../store/index'
import {isOldReddit, RedditPlatform,} from '../../util/infra/platform'
import {isModLogPage, isShredditModLogPage,} from '../../util/reddit/pageContext'
import {mountPopup,} from '../../util/ui/reactMount'
import {MatrixStyleProvider,} from './components/MatrixStyleProvider'
import {ModMatrixApp,} from './components/ModMatrixApp'
import type {ActionInfo,} from './schema'

function getSubredditModerators (): Record<string, Record<string, number>> {
	let modItems = Array.from(
		document.querySelectorAll('.drop-choices.lightdrop:not(.modaction-drop) a:not(.primary)',),
	)

	if (document.querySelector('.drop-choices.lightdrop:not(.modaction-drop) a.primary',)) {
		modItems = modItems.concat(
			Array.from(document.querySelectorAll('.dropdown.lightdrop:not(.modaction-drop) .selected',),),
		)
	}

	const moderators: Record<string, Record<string, number>> = {}
	for (const element of modItems) {
		const name = element.textContent ?? ''
		if (name === 'all' || /\*/.test(name,)) { continue }
		moderators[name] = {}
	}
	return moderators
}

function getQueryParam (name: string, href: string | null,): string | null {
	if (!href) { return null }
	const qmark = href.indexOf('?',)
	if (qmark === -1) { return null }
	return new URLSearchParams(href.slice(qmark + 1,),).get(name,)
}

function getSubredditActions (): Record<string, ActionInfo> {
	let actionItems = Array.from(document.querySelectorAll('.drop-choices.lightdrop.modaction-drop a',),)

	if (document.querySelector('.drop-choices.lightdrop.modaction-drop a.primary',)) {
		actionItems = actionItems.concat(
			Array.from(document.querySelectorAll('.dropdown.lightdrop.modaction-drop .selected',),),
		)
	}

	const actions: Record<string, ActionInfo> = {}
	for (const element of actionItems) {
		if (element.textContent === 'all') { continue }
		const actionCode = getQueryParam('type', element.getAttribute('href',),)
		if (actionCode) {
			actions[actionCode] = {title: element.textContent ?? actionCode, className: actionCode,}
		}
	}
	return actions
}

// Maps shreddit UPPER_SNAKE_CASE action names (lowercased with spaces) to titles
// that match ACTION_GROUPS entries in schema.ts for correct column grouping.
const shredditTitleCorrections: Record<string, string> = {
	'approve link': 'approve post',
	'remove link': 'remove post',
	'spam link': 'spam post',
	'spoiler': 'mark spoiler',
	'unspoiler': 'unmark spoiler',
	'mark original content': 'mark as original content',
	'set suggestedsort': 'set suggested sort',
	'set permissions': 'permissions',
	'community styling': 'style community',
	'community widgets': 'widgets',
	'community welcome page': 'community welcome_page',
	'override classification': 'override subreddit classification',
	'delete overridden classification': 'delete overridden subreddit classification',
	'wiki banned': 'ban from wiki',
	'wiki unbanned': 'unban from wiki',
	'wiki contributor': 'add wiki contributor',
	'wiki page listed': 'delist/relist wiki pages',
	'wiki perm level': 'wiki page permissions',
	'wiki revise': 'wiki revise page',
	'disable post crowd control filter': 'disable post crowd control filtering',
	'enable post crowd control filter': 'enable post crowd control filtering',
	'dev platform app changed': 'app changed',
	'dev platform app disabled': 'app disabled',
	'dev platform app enabled': 'app enabled',
	'dev platform app installed': 'app installed',
	'dev platform app uninstalled': 'app uninstalled',
	'hidden award': 'award hidden',
	'lock': 'lock post',
	'unlock': 'unlock post',
	'sticky': 'sticky post',
	'unsticky': 'unsticky post',
}

function getShredditSubredditActions (): Record<string, ActionInfo> {
	const templates = document.querySelectorAll('template[data-action-names]',)

	if (!templates.length) { return {} }

	const actions: Record<string, ActionInfo> = {}
	for (const template of Array.from(templates,)) {
		let names: string[]
		try {
			names = JSON.parse(template.getAttribute('data-action-names',) ?? '[]',) as string[]
		} catch {
			continue
		}
		for (const name of names) {
			const code = name.toLowerCase().replaceAll('_', '',)
			const rawTitle = name.toLowerCase().replaceAll('_', ' ',)
			const title = shredditTitleCorrections[rawTitle] ?? rawTitle
			actions[code] = {title, className: code,}
		}
	}
	return actions
}

function getShredditSubredditModerators (): Record<string, Record<string, number>> {
	const templates = document.querySelectorAll('template[data-moderator-name]',)
	const moderators: Record<string, Record<string, number>> = {}
	for (const template of Array.from(templates,)) {
		const name = template.getAttribute('data-moderator-name',)
		if (name) { moderators[name] = {} }
	}
	return moderators
}

/** Reads a subreddit's mod-log moderators and action types from the DOM for one Reddit platform. */
interface SubredditDataExtractor {
	/** Extracts the available action types keyed by action code. */
	extractActions: () => Record<string, ActionInfo>
	/** Extracts the moderator map (moderator name -> per-action counts, initially empty). */
	extractModerators: () => Record<string, Record<string, number>>
}

/** DOM extractor for old Reddit, reading the mod-log dropdown menus. */
const oldRedditExtractor: SubredditDataExtractor = {
	extractActions: getSubredditActions,
	extractModerators: getSubredditModerators,
}

/** DOM extractor for Shreddit, reading the `<template>` data attributes. */
const shredditExtractor: SubredditDataExtractor = {
	extractActions: getShredditSubredditActions,
	extractModerators: getShredditSubredditModerators,
}

const bundledStylesheetHref = browser.runtime.getURL('data/bundled.css',)

function getCrossOriginStylesheetHrefs (): string[] {
	const hrefs: string[] = []
	for (const sheet of document.styleSheets) {
		if (!sheet.href) { continue }
		try {
			// accessing cssRules throws for cross-origin sheets
			void sheet.cssRules
		} catch {
			hrefs.push(sheet.href,)
		}
	}
	return hrefs
}

/**
 * Reads the current subreddit URL from old Reddit's page header.
 * @returns The subreddit URL with a trailing slash, or `null` if not found.
 */
export function getSubredditUrl (): string | null {
	const href = document.querySelector('#header .hover.pagename.redditname a',)?.getAttribute('href',) ?? null
	if (!href) { return null }
	return href.charAt(href.length - 1,) !== '/' ? `${href}/` : href
}

/**
 * Extracts the subreddit name from a Reddit URL.
 * @returns The subreddit name (e.g. `"example"`), or `null` if the URL is `null` or does not match.
 */
export function getSubredditName (url: string | null,): string | null {
	if (!url) { return null }
	const matches = /reddit\.com\/r\/([^/]+)\//.exec(url,)
	return matches ? matches[1]! : null
}

/** Inserts a container `<span>` before the shreddit mod insights button and returns it, or null if not yet present. */
export function insertShredditControlsAnchor (): HTMLSpanElement | null {
	const modLogPage = document.querySelector('mod-log-page',)
	if (!modLogPage?.shadowRoot) { return null }
	const tracker = modLogPage.shadowRoot.querySelector(
		'faceplate-tracker[source="moderator"][action="click"][noun="mod_insights_summary"]',
	)
	if (!tracker) { return null }
	const container = document.createElement('span',)
	container.style.marginLeft = 'auto'
	tracker.insertAdjacentElement('beforebegin', container,)
	return container
}

/**
 * Mounts the Mod Log Matrix popup and returns a cleanup function that unmounts it.
 * @param subredditUrl URL of the subreddit the matrix is for, or `null` to read from the page.
 * @param subredditName Bare name of the subreddit, or `null` to read from the page.
 * @param onPopupClose Optional callback invoked when the popup is closed by the user.
 * @param initialActions Pre-populated action types; falls back to reading from the page's DOM.
 * @param initialModerators Pre-populated moderator map; falls back to reading from the page's DOM.
 * @returns A function that removes the popup from the DOM.
 */
export function showMatrixPopup (
	subredditUrl: string | null,
	subredditName: string | null,
	onPopupClose?: () => void,
	initialActions?: Record<string, ActionInfo>,
	initialModerators?: Record<string, Record<string, number>>,
): () => void {
	const hrefs = getCrossOriginStylesheetHrefs()
	const actions = initialActions ?? oldRedditExtractor.extractActions()
	const moderators = initialModerators ?? oldRedditExtractor.extractModerators()
	return mountPopup((onClose,) => {
		const handleClose = () => {
			onClose()
			onPopupClose?.()
		}
		return (
			<Provider store={store}>
				<MatrixStyleProvider hrefs={hrefs}>
					<link rel="stylesheet" type="text/css" href={bundledStylesheetHref} />
					<Backdrop onClickOutside={handleClose}>
						<div
							style={{
								width: 'min(1400px, calc(100vw - 40px))',
								height: '90vh',
								overflow: 'hidden',
							}}
						>
							<ModMatrixApp
								subredditUrl={subredditUrl}
								subredditName={subredditName}
								initialModerators={moderators}
								initialActions={actions}
								onClose={handleClose}
							/>
						</div>
					</Backdrop>
				</MatrixStyleProvider>
			</Provider>
		)
	},)
}

/**
 * Sets up the `modLogControls` UI location for the current page and returns subreddit metadata.
 *
 * Old Reddit: queries the menuarea synchronously and provides the location immediately.
 * Shreddit: tries to insert the controls anchor immediately; if the element is not yet present
 * (shreddit renders asynchronously), spins up an internal MutationObserver that retries.
 * The observer is managed by the returned cleanup - no lifecycle argument needed.
 *
 * Call `lifecycle.mount(setup.cleanup)` in `index.ts`.
 *
 * @returns `{subredditUrl, subredditName, cleanup}`.
 */
export function createModMatrixSetup (): {
	subredditUrl: string | null
	subredditName: string | null
	cleanup: () => void
} {
	const cleanups: Array<() => void> = []
	let subredditUrl: string | null = null
	let subredditName: string | null = null

	if (isOldReddit && isModLogPage) {
		subredditUrl = getSubredditUrl()
		subredditName = getSubredditName(subredditUrl,)

		const menuarea = getMenuarea()
		if (menuarea) {
			cleanups.push(provideLocation('modLogControls', menuarea, {
				platform: RedditPlatform.Old,
				kind: 'page',
			}, {shadow: false, hostTag: 'span',},),)
		}
	} else if (!isOldReddit && isShredditModLogPage) {
		subredditName = isShredditModLogPage[1] ?? null
		subredditUrl = subredditName ? `https://www.reddit.com/r/${subredditName}/` : null

		const immediate = insertShredditControlsAnchor()
		if (immediate) {
			cleanups.push(() => immediate.remove())
			cleanups.push(provideLocation('modLogControls', immediate, {
				platform: RedditPlatform.Shreddit,
				kind: 'page',
			}, {shadow: false,},),)
		} else {
			// Shreddit renders its mod-log-page element asynchronously; poll via MutationObserver.
			// The observer manages its own lifecycle via the returned cleanup, so no Lifecycle arg is needed.
			let containerCleanup: (() => void) | null = null
			const observer = new MutationObserver((_mutations, obs,) => {
				const c = insertShredditControlsAnchor()
				if (!c) { return }
				const provideCleanup = provideLocation('modLogControls', c, {
					platform: RedditPlatform.Shreddit,
					kind: 'page',
				}, {shadow: false,},)
				containerCleanup = () => {
					c.remove()
					provideCleanup()
				}
				obs.disconnect()
			},)
			observer.observe(document.body, {childList: true, subtree: true,},)
			cleanups.push(() => {
				observer.disconnect()
				containerCleanup?.()
			},)
		}
	}

	return {
		subredditUrl,
		subredditName,
		cleanup () {
			for (const c of cleanups) { c() }
		},
	}
}

/**
 * Returns a React render function for the matrix toggle button, adapting markup for the current Reddit platform.
 * Extracted from `index.tsx` so that UI logic lives in the DOM layer, not the module entry point.
 * @param onClick Handler invoked when the button is clicked.
 */
export function createMatrixButtonRender (onClick: () => void,): () => ReactElement {
	if (isOldReddit) {
		return function MatrixButton () {
			return (
				<ActionButton className="toolbox-matrix-toggle" onClick={onClick}>
					moderation log matrix
				</ActionButton>
			)
		}
	}
	return function MatrixButton () {
		return (
			<button
				// @ts-expect-error - rpl is a Reddit design-system attribute, not a standard HTML attribute
				rpl=""
				className="ms-sm me-md button-small px-[calc(var(--rem10)-var(--button-border-width,0px))] button-secondary items-center justify-center button inline-flex"
				onClick={onClick}
			>
				moderation log matrix
			</button>
		)
	}
}

/**
 * Creates event handlers for the "moderation log matrix" button, managing popup open/close state.
 * @returns An object with a `handleButtonClick` method to attach to the button's click event.
 */
export function createModMatrixHandlers (
	subredditUrl: string | null,
	subredditName: string | null,
) {
	let closePopup: (() => void) | null = null

	return {
		handleButtonClick () {
			if (!closePopup) {
				// Old Reddit falls back to showMatrixPopup's own extraction; only Shreddit needs to
				// pass pre-read data (its templates are gone by the time the popup mounts).
				const isShreddit = !isOldReddit && isShredditModLogPage
				const extractor = isShreddit ? shredditExtractor : undefined
				closePopup = showMatrixPopup(
					subredditUrl,
					subredditName,
					() => {
						closePopup = null
					},
					extractor?.extractActions(),
					extractor?.extractModerators(),
				)
			}
		},
	}
}
