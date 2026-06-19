/** DOM integration for the Mod View Enhancements module - applies visual and informational augmentations to submissions and reports across the mod queue, subreddit listings, and comment pages. */
import {isModSub,} from '../../api/resources/modSubs'
import {getModLog,} from '../../api/resources/subreddits'
import {getCurrentSubredditName, getSiteTable,} from '../../dom/oldReddit/page'
import {
	getModReports,
	getSpamThings,
	getThingMarkdownEls,
	getThingScoreTextEl,
	getThingTitleLinks,
} from '../../dom/oldReddit/queue'
import {
	getEntry,
	getThingByFullname,
	getThingFromDescendant,
	getThingRemovedBy,
	getThings,
	getThingSubredditName,
} from '../../dom/oldReddit/things'
import {
	getQueueItemReasons,
	getQueueItems,
	getQueueItemScore,
	getQueueItemSubreddit,
	getQueueItemTextBodyEl,
} from '../../dom/shreddit/queue'
import {collectMatches,} from '../../dom/shreddit/things'
import {comments,} from '../../framework/moduleIds'
import createLogger from '../../util/infra/logging'
import {isCommentsPage, isMod, isModpage,} from '../../util/reddit/pageContext'
import {cleanSubredditName, stringToColor,} from '../../util/reddit/reddit-domain'
import {highlight, removeHighlight,} from '../../util/ui/highlight'

import {getSettingAsync,} from '../../util/persistence/settings'
import {mountToTarget,} from '../../util/ui/reactMount'
import type {ModViewEnhancementsSettings,} from './settings'

import {iconBot,} from './botIcon'
import {AutomodActionReason,} from './components/AutomodActionReason'

const log = createLogger('ModViewEnhancements',)

/**
 * Checks whether `subredditName` is a modded subreddit, then applies the configured border color to `element`.
 * Marks `element` with `color-processed` immediately so subsequent calls are no-ops.
 */
async function applySubredditColor (
	element: Element,
	subredditName: string,
	overrides: Record<string, string>,
	salt: string,
) {
	element.classList.add('color-processed',)
	const isModded = await isModSub(subredditName,)
	if (!isModded) { return }
	const overrideKey = Object.keys(overrides,).find((k,) => k.toLowerCase() === subredditName.toLowerCase())
	const color = (overrideKey ? overrides[overrideKey] : null) ?? stringToColor(subredditName + salt,)
	;(element as HTMLElement).style.setProperty('--toolbox-sub-color', color,)
	element.classList.add('toolbox-subreddit-color',)
}

/**
 * Returns all substrings captured inside `[...]` brackets in the given text.
 * Creates a fresh regex each call to avoid shared `lastIndex` state across concurrent callers.
 */
function extractBracketedMatches (text: string,): string[] {
	const matches: string[] = []
	const re = /\[(.*?)\]/g
	let m
	while ((m = re.exec(text,))) {
		matches.push(m[1]!,)
	}
	return matches
}

/**
 * Highlights automod `matchesArray` on each element, layering the user's saved
 * `highlightEnabled` keywords on top when any are configured. When highlights are layered the
 * element's prior highlights are cleared first, so a re-run doesn't stack duplicate spans.
 * @param elements The elements to highlight (a collection or a single-element array).
 * @param matchesArray The automod bracketed matches to highlight.
 * @param highlightEnabled The user's saved highlight keywords; empty skips the extra layer.
 */
function applyAutomodHighlights (
	elements: Iterable<Element>,
	matchesArray: string[],
	highlightEnabled: string[],
): void {
	for (const element of elements) {
		if (highlightEnabled.length > 0) {
			removeHighlight(element,)
			highlight(element, matchesArray, false, true,)
			highlight(element, highlightEnabled,)
		} else {
			highlight(element, matchesArray, false, true,)
		}
	}
}

/**
 * Initializes mod-view enhancement effects and returns handlers for ongoing DOM mutations.
 * Runs immediately on call for the current page state, then returns handlers for new items.
 * @param settings Current module settings.
 * @returns An object exposing the resolved `shouldHighlightMatches` gate plus handlers for new
 *   things, expandos, and Shreddit mutations.
 */
export function createModViewEnhancementsHandlers ({
	highlightNegativePosts,
	showAutomodActionReason,
	subredditColor,
	subredditColorSalt,
	subredditColorOverrides,
	highlightAutomodMatches,
	highlightAutomodMatchesSubreddit,
	botCheckmark,
}: ModViewEnhancementsSettings,) {
	// On the queue the long-standing `highlightAutomodMatches` setting controls bracket
	// highlighting; off the queue it's the opt-in `highlightAutomodMatchesSubreddit` setting, and
	// only for mods (so `.report-reasons .mod-report` elements exist on the page).
	const shouldHighlightMatches = isModpage
		? highlightAutomodMatches
		: (isMod && highlightAutomodMatchesSubreddit)
	/** Observers created by handleExpando that are still waiting for .md to appear. */
	const pendingExpandoObservers = new Set<{observer: MutationObserver; timeoutId: ReturnType<typeof setTimeout>}>()
	let botStyleEl: HTMLStyleElement | null = null

	// Created once and shared by every consumer below. Give it a safe default on rejection so a
	// single failed settings read can't propagate to (and break) every later `await`/`.then` site.
	const highlightEnabledPromise = getSettingAsync(comments, 'highlighted', [] as string[],)
		.catch(() => [] as string[])

	function colorSubreddits (element: Element,) {
		const subredditName = cleanSubredditName(getThingSubredditName(element,) ?? '',)
		void applySubredditColor(element, subredditName, subredditColorOverrides, subredditColorSalt,)
	}

	if (subredditColor) {
		log.debug('adding sub colors',)
		getThings().forEach((element,) => void colorSubreddits(element,))
	}

	function highlightBadPosts (element: Element,) {
		element.classList.add('highlight-processed',)
		let score: string | number = getThingScoreTextEl(element,)?.textContent || ''
		score = /\d+/.test(score as string,) ? parseInt(score as string, 10,) : 0
		if (score > 0) { return }
		element.classList.add('toolbox-zero-highlight',) // Intentional: marker class on Reddit element, not toolbox UI.
	}

	if (highlightNegativePosts && isModpage) {
		getThings().filter((t,) => !t.classList.contains('highlight-processed',)).forEach((element,) =>
			highlightBadPosts(element,)
		)
	}

	async function getAutomodActionReason (subreddit: string,) {
		log.debug(subreddit,)
		const highlightEnabled = await highlightEnabledPromise
		let json: any
		try {
			json = await getModLog(subreddit, {limit: '500', mod: 'AutoModerator',},)
		} catch (err) {
			log.error('getAutomodActionReason: getModLog failed', err,)
			return
		}
		json.data.children.forEach((value: any,) => {
			const actionReasonText = value.data.details
			const targetFullName = value.data.target_fullname
			const targetThing = getThingByFullname(targetFullName,)
			if (targetThing) {
				const entry = getEntry(targetThing,)
				if (entry) {
					const container = document.createElement('div',)
					entry.after(container,)
					mountToTarget(
						<AutomodActionReason
							actionReasonText={actionReasonText}
							subreddit={subreddit}
							permalink={value.data.target_permalink}
						/>,
						container,
						{shadow: false,},
					)
				}
			}
			if (highlightAutomodMatches) {
				const matchesArray = extractBracketedMatches(actionReasonText,)
				const mdElements = targetThing ? getThingMarkdownEls(targetThing,) : []
				applyAutomodHighlights(mdElements, matchesArray, highlightEnabled,)
			}
		},)
	}

	if (isMod && isCommentsPage && showAutomodActionReason && getSpamThings().length > 0) {
		void getAutomodActionReason(getCurrentSubredditName() ?? '',)
	}

	async function highlightedMatches () {
		const highlightEnabled = await highlightEnabledPromise
		getModReports().forEach((modReport,) => {
			if (!modReport.classList.contains('hl-processed',)) {
				modReport.classList.add('hl-processed',) // Intentional: marker class on Reddit element, not toolbox UI.
				const reportText = modReport.textContent ?? ''
				const reportTextLower = reportText.toLowerCase()
				if (botCheckmark.some((bot: string,) => reportTextLower.includes(`${bot.toLowerCase()}:`,))) {
					const matchesArray = extractBracketedMatches(reportText,)
					const thing = getThingFromDescendant(modReport,)
					applyAutomodHighlights(thing ? getThingTitleLinks(thing,) : [], matchesArray, highlightEnabled,)
					applyAutomodHighlights(thing ? getThingMarkdownEls(thing,) : [], matchesArray, highlightEnabled,)
				}
			}
		},)
	}

	if (shouldHighlightMatches) {
		void highlightedMatches()
	}

	if (isModpage && showAutomodActionReason) {
		const queueSubs: string[] = []
		log.debug('getting automod action reasons',)
		const siteTableEl = getSiteTable()
		;(siteTableEl ? getThings(siteTableEl,) : []).forEach((thing,) => {
			const subreddit = cleanSubredditName(getThingSubredditName(thing,) ?? '',)
			const removedBy = getThingRemovedBy(thing,) ?? ''
			if (!queueSubs.includes(subreddit,) && removedBy === '[ removed by AutoModerator (remove not spam) ]') {
				queueSubs.push(subreddit,)
			}
		},)
		queueSubs.forEach((subreddit,) => void getAutomodActionReason(subreddit,))
	}

	const selectors = (botCheckmark as string[]).map(
		(bot,) => `img.approval-checkmark[title*="approved by ${bot}" i]`,
	)
	if (selectors.length && isMod) {
		if (!botStyleEl) {
			botStyleEl = document.createElement('style',)
			document.head.appendChild(botStyleEl,)
		}
		botStyleEl.textContent = `
            ${selectors.join(',',)} {
                display: inline-block;
                padding-left: 16px;
                padding-top: 5px;
                background-image: url("${iconBot}");
                background-repeat: no-repeat;
            }
        `
	}

	return {
		// Exposed so callers (index.ts) gate the expando re-highlight listener on the same condition
		// used here, rather than re-deriving it and risking drift.
		shouldHighlightMatches,

		handleNewThings () {
			if (subredditColor) {
				log.debug('adding sub colors (new)',)
				getThings().filter((t,) => !t.classList.contains('color-processed',)).forEach((element,) =>
					void colorSubreddits(element,)
				)
			}
			if (highlightNegativePosts && isModpage) {
				log.debug('adding zero-score highlights',)
				getThings().filter((t,) => !t.classList.contains('highlight-processed',)).forEach((element,) =>
					highlightBadPosts(element,)
				)
			}
			if (shouldHighlightMatches) {
				void highlightedMatches()
			}
		},

		handleExpando (expandoButton: Element,) {
			const thing = expandoButton.closest('.thing',)
			if (!thing) { return }

			const rerun = () => {
				thing.querySelectorAll('.hl-processed',).forEach((element,) =>
					element.classList.remove('hl-processed',)
				)
				void highlightedMatches()
			}

			// Self-post content may already be in DOM (pre-rendered hidden) or loaded via AJAX.
			if (thing.querySelector('.md',)) {
				rerun()
			} else {
				// Watch for the .md to be inserted after the AJAX load completes.
				const entry = {
					observer: null as unknown as MutationObserver,
					timeoutId: null as unknown as ReturnType<typeof setTimeout>,
				}
				const cleanup = () => {
					entry.observer.disconnect()
					clearTimeout(entry.timeoutId,)
					pendingExpandoObservers.delete(entry,)
				}
				entry.observer = new MutationObserver(() => {
					if (thing.querySelector('.md',)) {
						cleanup()
						rerun()
					}
				},)
				entry.timeoutId = setTimeout(cleanup, 5000,)
				entry.observer.observe(thing, {childList: true, subtree: true,},)
				pendingExpandoObservers.add(entry,)
			}
		},

		// --- Shreddit queue handlers ---
		// `this` in handleShredditMutations/initShreddit refers to this returned object because
		// index.ts always calls these as mve.handleShredditMutations(...) and mve.initShreddit().

		processShredditItem (item: Element,) {
			if (item.classList.contains('toolbox-mve-processed',)) { return }
			item.classList.add('toolbox-mve-processed',)

			if (subredditColor) {
				const subredditName = cleanSubredditName(getQueueItemSubreddit(item,),)
				if (subredditName) {
					void applySubredditColor(item, subredditName, subredditColorOverrides, subredditColorSalt,)
				}
			}

			if (highlightNegativePosts) {
				if (getQueueItemScore(item,) <= 0) {
					item.classList.add('toolbox-zero-highlight',)
				}
			}

			if (highlightAutomodMatches) {
				const reasons = getQueueItemReasons(item,)
				const matchesArray: string[] = []
				for (const reason of reasons) {
					if (
						reason.icon !== 'AUTOMOD' && !botCheckmark.some(
							(bot: string,) => reason.actor?.displayName.toLowerCase() === bot.toLowerCase(),
						)
					) { continue }
					matchesArray.push(...extractBracketedMatches(reason.title,),)
				}
				if (matchesArray.length > 0) {
					const textBody = getQueueItemTextBodyEl(item,)
					if (textBody) {
						void highlightEnabledPromise.then((highlightEnabled,) => {
							applyAutomodHighlights([textBody,], matchesArray, highlightEnabled,)
						},)
					}
				}
			}
		},

		handleShredditMutations (mutations: MutationRecord[],) {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (!(node instanceof Element)) { continue }
					for (const item of collectMatches(node, 'shreddit-post[view-context="ModQueue"]',)) {
						this.processShredditItem(item,)
					}
				}
			}
		},

		initShreddit () {
			getQueueItems().forEach((item,) => this.processShredditItem(item,))
		},

		/** Cancels pending expando observers/timeouts and removes the injected bot-checkmark style element. */
		cleanup () {
			for (const entry of pendingExpandoObservers) {
				entry.observer.disconnect()
				clearTimeout(entry.timeoutId,)
			}
			pendingExpandoObservers.clear()
			botStyleEl?.remove()
			botStyleEl = null
		},
	}
}
