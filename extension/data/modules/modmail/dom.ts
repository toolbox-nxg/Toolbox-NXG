/** DOM manipulation and event handlers for the Modmail module on the new Reddit (Shreddit) modmail UI. */

import {createElement,} from 'react'

import {provideLocation, renderAtLocation,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import {negativeTextFeedback, positiveTextFeedback,} from '../../store/feedback'
import {replaceTokens,} from '../../util/data/string'
import {RedditPlatform,} from '../../util/infra/platform'
import {MacroSelect,} from '../macros/components/MacroSelect'
import {MacroConfig, ThingInfo,} from '../macros/schema'
import {UserSidebarPanel,} from './components/UserSidebarPanel'
import type {ModmailSettings,} from './settings'

/** Lifecycle callbacks returned by {@link createModmailHandlers}. */
export interface ModmailHandlers {
	/** Removes all toolbox DOM additions injected by this module instance. */
	cleanup: () => void
	/** Scans `root` and applies all enabled modmail enhancements to any matching elements found within it. */
	scan: (root: Element,) => void
	/** Processes a batch of MutationRecords, scanning any newly added elements. */
	handleMutations: (mutations: MutationRecord[],) => void
}

const oneDayMs = 24 * 60 * 60 * 1000
const recentTimestampFormatter = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
},)

function queryDeep<T extends Element,> (root: Element | ShadowRoot, selector: string,): T | null {
	if (root instanceof Element && root.shadowRoot) {
		const found = queryDeep<T>(root.shadowRoot, selector,)
		if (found) { return found }
	}

	const direct = root.querySelector<T>(selector,)
	if (direct) { return direct }

	for (const element of root.querySelectorAll('*',)) {
		const sr = element.shadowRoot
		if (sr) {
			const found = queryDeep<T>(sr, selector,)
			if (found) { return found }
		}
	}

	return null
}

/**
 * Formats a date as a short human-readable timestamp if the message is less than 24 hours old.
 * @param date The date to format.
 * @param now The reference point for "now"; defaults to the current time.
 * @returns A formatted string like "Jun 4, 3:05 PM", or `null` if the date is invalid or older than 24 hours.
 */
export function formatRecentModmailTimestamp (date: Date, now = new Date(),): string | null {
	if (Number.isNaN(date.getTime(),)) { return null }

	const age = now.getTime() - date.getTime()
	if (age < 0 || age >= oneDayMs) { return null }

	return recentTimestampFormatter.format(date,)
}

function showRecentMessageTimes (root: Element,) {
	const candidates = root.matches('time[datetime]',)
		? [root as HTMLTimeElement,]
		: Array.from(root.querySelectorAll<HTMLTimeElement>('time[datetime]',),)

	for (const timeEl of candidates) {
		const formatted = formatRecentModmailTimestamp(new Date(timeEl.dateTime,),)
		if (!formatted) { continue }

		if (!timeEl.dataset.toolboxOriginalText) {
			timeEl.dataset.toolboxOriginalText = timeEl.textContent ?? ''
		}
		timeEl.textContent = formatted
	}
}

/**
 * Reports whether the modmail user info sidebar (mod notes rail) is currently expanded.
 * Reddit toggles the `hidden` class on `mod-notes-rail-closer` to collapse the rail, so a
 * present-and-not-hidden closer means the sidebar is open.
 */
function isUserSidebarOpen (): boolean {
	const closer = document.querySelector('mod-notes-rail-closer',)
	return !!closer && !closer.classList.contains('hidden',)
}

function getConversationId (): string {
	const match = document.location.pathname.match(/\/mail\/[^/]+\/([^/?#]+)/,)
	return match?.[1] ?? ''
}

function getSubredditFromSavedResponses (root: Element,): string | null {
	const link = root.querySelector<HTMLAnchorElement>('a[href^="/mod/"][href*="/saved-responses"]',)
		?? document.querySelector<HTMLAnchorElement>('a[href^="/mod/"][href*="/saved-responses"]',)
	const match = link?.pathname.match(/^\/mod\/([^/]+)\/saved-responses/,)
	if (match?.[1]) { return match[1] }

	const opener = document.querySelector('mod-notes-opener[subreddit-name]',)
	return opener?.getAttribute('subreddit-name',) ?? null
}

function getAuthorFromPage (): string {
	const opener = document.querySelector('mod-notes-opener[user-name]',)
	return opener?.getAttribute('user-name',) ?? ''
}

function makeModmailTokenInfo (subreddit: string,): ThingInfo {
	const author = getAuthorFromPage()
	const conversationId = getConversationId()
	const permalink = document.location.href

	return {
		subreddit,
		user: author,
		author,
		permalink,
		url: permalink,
		domain: '',
		id: conversationId,
		// A modmail conversation has no post/comment fullname.
		fullname: '',
		body: '',
		raw_body: '',
		uri_body: '',
		approved_by: '',
		title: document.title,
		uri_title: encodeURIComponent(document.title,),
		kind: 'modmail',
		postlink: '',
		link: permalink,
		banned_by: null,
		spam: false,
		ham: false,
		rules: '',
		sidebar: '',
		wiki: '',
		mod: '',
	}
}

function dispatchComposerInput (target: Element,) {
	target.dispatchEvent(new InputEvent('input', {bubbles: true, composed: true, inputType: 'insertText',},),)
	target.dispatchEvent(new Event('change', {bubbles: true, composed: true,},),)
}

/**
 * Inserts `text` at the textarea/input's caret (or at the end when no selection is reported),
 * moves the caret past the inserted text, then notifies listeners and focuses the field.
 * @param field The textarea or text input to insert into.
 * @param text The text to insert.
 */
function insertIntoTextarea (field: HTMLTextAreaElement | HTMLInputElement, text: string,): void {
	const start = field.selectionStart ?? field.value.length
	const end = field.selectionEnd ?? field.value.length
	field.value = `${field.value.slice(0, start,)}${text}${field.value.slice(end,)}`
	const cursor = start + text.length
	field.setSelectionRange(cursor, cursor,)
	dispatchComposerInput(field,)
	field.focus()
}

/**
 * Inserts `text` into a contenteditable/textbox element at the current selection when that
 * selection lies inside the element; otherwise appends it to the existing content. Notifies
 * listeners afterwards.
 * @param editable The contenteditable or `role="textbox"` element to insert into.
 * @param text The text to insert.
 */
function insertIntoContentEditable (editable: HTMLElement, text: string,): void {
	editable.focus()
	const selection = getSelection()
	if (selection?.rangeCount && editable.contains(selection.anchorNode,)) {
		const range = selection.getRangeAt(0,)
		range.deleteContents()
		range.insertNode(document.createTextNode(text,),)
		range.collapse(false,)
		selection.removeAllRanges()
		selection.addRange(range,)
	} else {
		editable.textContent = `${editable.textContent ?? ''}${text}`
	}
	dispatchComposerInput(editable,)
}

/**
 * Inserts `text` into a modmail composer, preferring a textarea/input and falling back to a
 * contenteditable/textbox.
 * @returns `true` if an insertion target was found, `false` otherwise.
 */
function insertIntoComposer (composer: Element, text: string,): boolean {
	const textarea = queryDeep<HTMLTextAreaElement | HTMLInputElement>(composer, 'textarea, input[type="text"]',)
	if (textarea) {
		insertIntoTextarea(textarea, text,)
		return true
	}

	const editable = queryDeep<HTMLElement>(composer, '[contenteditable="true"], [role="textbox"]',)
	if (editable) {
		insertIntoContentEditable(editable, text,)
		return true
	}

	return false
}

async function applyModmailMacro (wrapper: Element, subreddit: string, macro: MacroConfig, reset: () => void,) {
	const composer = wrapper.querySelector('shreddit-composer',)
	if (!composer) {
		negativeTextFeedback('Could not find modmail composer',)
		reset()
		return
	}

	const text = replaceTokens(makeModmailTokenInfo(subreddit,) as Record<string, string>, macro.text ?? '',)
	if (!insertIntoComposer(composer, text,)) {
		negativeTextFeedback('Could not insert modmail macro',)
		reset()
		return
	}

	positiveTextFeedback('Inserted modmail macro',)
	reset()
}

/**
 * Creates DOM handlers for the Modmail module, configured according to the given settings.
 *
 * Uses vanilla DOM manipulation throughout because the features require operating inside Reddit's
 * own shadow DOM, which React cannot reach.
 *
 * @returns Handlers for scanning new DOM nodes and cleaning up all toolbox additions.
 */
export function createModmailHandlers (
	{
		previewByDefault,
		searchAtTop,
		showRecentMessageTime,
		hideUserSidebarProfileIcon,
		usernameProfileWhenSidebarOpen,
		replaceUserSidebarTabs,
	}: ModmailSettings,
): ModmailHandlers {
	const processedElements = new WeakSet<Element>()
	let macroSelectIdCounter = 0
	const macroSelectCleanups = new Map<Element, () => void>()
	let userPanelIdCounter = 0
	const userPanelCleanups = new Map<Element, () => void>()
	// Owns the listeners/observers/timeouts used by the preview-button auto-click logic, so a
	// module teardown mid-wait cancels them instead of leaking or firing after cleanup.
	const scope = createLifecycle()

	function addModmailMacroSelect (wrapper: Element,) {
		// Modmail is a Shreddit SPA: opening a thread mounts a fresh modmail-thread-wrapper
		// view, but Reddit may leave the previous view's wrapper attached. Enforce a
		// single-button invariant so navigations don't accumulate duplicate macro buttons.
		// Tear down every tracked entry that isn't the wrapper we're processing now, reusing
		// its clean() so the React root / location provider is released instead of leaked.
		// (Snapshot first because clean() mutates macroSelectCleanups.)
		for (const [tracked, clean,] of [...macroSelectCleanups,]) {
			if (tracked !== wrapper) { clean() }
		}

		// Re-scans of the same wrapper are no-ops while our host is still mounted...
		if (macroSelectCleanups.has(wrapper,)) {
			if (wrapper.querySelector('.toolbox-modmail-macro-select',)) { return }
			// ...but if Reddit re-rendered the toolbar subtree and detached our host, release
			// the stale React root before re-inserting a fresh one below.
			macroSelectCleanups.get(wrapper,)?.()
		}

		const savedResponses = wrapper.querySelector('#modmail-saved-responses-dropdown',)
		if (!savedResponses?.parentElement) { return }

		const subreddit = getSubredditFromSavedResponses(wrapper,)
		if (!subreddit) { return }

		const host = document.createElement('span',)
		host.classList.add('toolbox-modmail-macro-select',)
		savedResponses.after(host,)

		const id = `modmail.macroSelect.${++macroSelectIdCounter}`
		const unprovide = provideLocation('modmailComposerControls', host, {
			platform: RedditPlatform.Shreddit,
			kind: 'modmailComposer',
			subreddit,
		}, {shadow: false, hostTag: 'span',},)
		const unrender = renderAtLocation(
			'modmailComposerControls',
			{id,},
			({context,},) =>
				createElement(MacroSelect, {
					subreddit: context.subreddit ?? '',
					type: 'modmail',
					presentation: 'button',
					label: 'Mod macros',
					onSelectMacro: async (macro: MacroConfig, _dropdown: Element, reset: () => void,) => {
						await applyModmailMacro(wrapper, context.subreddit ?? '', macro, reset,)
					},
				},),
		)

		const clean = () => {
			unrender()
			unprovide()
			host.remove()
			macroSelectCleanups.delete(wrapper,)
		}
		macroSelectCleanups.set(wrapper, clean,)
	}

	/**
	 * Mounts the stacked activity panel next to the native `<mod-notes-tabs>` widget in the user
	 * sidebar (the native tabs are hidden by CSS while this feature is on). The tab element carries
	 * `username`/`subreddit-name` and re-mounts per conversation, so it is both the anchor and the
	 * single-panel key. Mirrors {@link addModmailMacroSelect}'s single-instance / re-render handling.
	 */
	function addUserSidebarPanel (tabs: Element,) {
		// Reddit may leave a stale rail attached across navigations; keep exactly one panel by
		// tearing down trackers for any other tab element. (Snapshot first; clean() mutates the map.)
		for (const [tracked, clean,] of [...userPanelCleanups,]) {
			if (tracked !== tabs) { clean() }
		}

		if (userPanelCleanups.has(tabs,)) {
			// Still mounted next to this tab element: nothing to do.
			if (tabs.nextElementSibling?.classList.contains('toolbox-modmail-user-panel',)) { return }
			// Reddit re-rendered the rail and detached our host; release the stale root before re-mounting.
			userPanelCleanups.get(tabs,)?.()
		}

		const user = tabs.getAttribute('username',) || getAuthorFromPage()
		const subreddit = tabs.getAttribute('subreddit-name',) || getSubredditFromSavedResponses(document.body,)
		if (!user || !subreddit) { return }
		const conversationId = getConversationId()

		const host = document.createElement('div',)
		host.classList.add('toolbox-modmail-user-panel',)
		tabs.after(host,)

		const id = `modmail.userSidebar.${++userPanelIdCounter}`
		const unprovide = provideLocation('modmailUserSidebar', host, {
			platform: RedditPlatform.Shreddit,
			kind: 'user',
			subreddit,
			author: user,
		}, {shadow: false, hostTag: 'div',},)
		const unrender = renderAtLocation(
			'modmailUserSidebar',
			{id,},
			() => createElement(UserSidebarPanel, {subreddit, user, conversationId,},),
		)

		const clean = () => {
			unrender()
			unprovide()
			host.remove()
			userPanelCleanups.delete(tabs,)
		}
		userPanelCleanups.set(tabs, clean,)
	}

	if (searchAtTop) {
		document.body.classList.add('toolbox-modmail-search-top',)
	}

	if (hideUserSidebarProfileIcon) {
		document.body.classList.add('toolbox-modmail-hide-sidebar-profile',)
	}

	if (replaceUserSidebarTabs) {
		document.body.classList.add('toolbox-modmail-replace-sidebar-tabs',)
	}

	if (usernameProfileWhenSidebarOpen) {
		// Run in the capture phase so we beat Reddit's mod-notes-opener, which hijacks the
		// username click to (re)open the user info sidebar. When the sidebar is already open we
		// stop that hijack but leave the default anchor navigation intact, so the slotted
		// <a target="_blank"> opens the participant's profile in a new tab (modifier clicks too).
		scope.on(document, 'click', (event,) => {
			const target = event.target as Element | null
			if (!target?.closest('mod-notes-opener[trigger-source="modmail-username"]',)) { return }
			if (!isUserSidebarOpen()) { return }
			event.stopImmediatePropagation()
		}, {capture: true,},)
	}

	// The preview button lives in modmail-thread-wrapper's shadow DOM, not shreddit-composer's.
	// shreddit-composer is slotted content; the wrapper owns the toolbar.
	function handleThreadWrapper (wrapper: Element,) {
		addModmailMacroSelect(wrapper,)

		if (processedElements.has(wrapper,)) { return }

		const composer = wrapper.querySelector('shreddit-composer',)
		if (!composer) { return }

		processedElements.add(wrapper,)

		// input bubbles out of shreddit-composer's shadow DOM (composed=true). Attach the listener
		// immediately - the composer already exists - so the very first keystroke is never missed.
		// The preview button itself lives in shadow DOM and may not have rendered yet (and starts
		// disabled), so resolve its readiness lazily *inside* the handler rather than gating the
		// listener on a poll that could attach after the user has already typed.
		scope.on(composer, 'input', () => {
			let attempts = 0
			const maxAttempts = 40 // 4 seconds at 100ms

			// Poll until the button has rendered, then watch for Lit to enable it, then click.
			const waitForButton = () => {
				const button = queryDeep<HTMLButtonElement>(wrapper, 'button:has(svg[icon-name="show"])',)
				if (!button) {
					if (++attempts < maxAttempts) { scope.timeout(waitForButton, 100,) }
					return
				}
				if (!button.disabled) {
					button.click()
					return
				}
				const stopAttrTimeout = scope.timeout(() => {
					void stopAttrObserver()
				}, 2000,)
				const stopAttrObserver = scope.observe(button, () => {
					if (!button.disabled) {
						button.click()
						void stopAttrTimeout()
						void stopAttrObserver()
					}
				}, {attributes: true, attributeFilter: ['disabled',],},)
			}

			waitForButton()
		}, {once: true,},)
	}

	function applySearchAtTop () {
		const redditSearch = document.querySelector('reddit-search-large',)
		const nativeForm = document.getElementById('modmail-search-form',)
		if (!redditSearch || !nativeForm || processedElements.has(nativeForm,)) { return }

		processedElements.add(redditSearch,)
		processedElements.add(nativeForm,)
		nativeForm.classList.remove('hidden', 'mt-md',)
		redditSearch.parentElement?.insertBefore(nativeForm, redditSearch,)
	}

	/**
	 * Calls `handler` for `root` if it matches `selector`, then for every descendant that does.
	 * Mirrors the "self-or-descendant" scan pattern used throughout this module.
	 */
	function scanWith (root: Element, selector: string, handler: (el: Element,) => void,) {
		if (root.matches(selector,)) { handler(root,) }
		for (const el of root.querySelectorAll(selector,)) { handler(el,) }
	}

	function scan (root: Element,) {
		if (showRecentMessageTime) {
			showRecentMessageTimes(root,)
		}

		// handleThreadWrapper calls addModmailMacroSelect internally, so when previewByDefault
		// is true we only need the one pass.
		scanWith(root, 'modmail-thread-wrapper', previewByDefault ? handleThreadWrapper : addModmailMacroSelect,)

		if (replaceUserSidebarTabs) {
			scanWith(root, 'mod-notes-tabs', addUserSidebarPanel,)
		}

		if (searchAtTop) {
			applySearchAtTop()
		}
	}

	function handleMutations (mutations: MutationRecord[],) {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node instanceof Element) { scan(node,) }
			}
		}

		// When a thread view is removed without a replacement (e.g. the user clicks "<- all"
		// and stops), release any tracked wrapper that's no longer in the document so its
		// React root isn't held until full module cleanup. Snapshot since clean() mutates.
		if (mutations.some((mutation,) => mutation.removedNodes.length > 0)) {
			for (const [tracked, clean,] of [...macroSelectCleanups,]) {
				if (!tracked.isConnected) { clean() }
			}
			for (const [tracked, clean,] of [...userPanelCleanups,]) {
				if (!tracked.isConnected) { clean() }
			}
		}
	}

	function cleanup () {
		document.body.classList.remove('toolbox-modmail-search-top',)
		document.body.classList.remove('toolbox-modmail-hide-sidebar-profile',)
		document.body.classList.remove('toolbox-modmail-replace-sidebar-tabs',)
		for (const fn of macroSelectCleanups.values()) { fn() }
		for (const fn of userPanelCleanups.values()) { fn() }
		void scope.cleanup()
	}

	return {cleanup, scan, handleMutations,}
}
