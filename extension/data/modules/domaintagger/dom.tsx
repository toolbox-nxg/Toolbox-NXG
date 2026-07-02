/** DOM logic for the Domain Tagger module: applies color tags to link domains on both old Reddit and Shreddit. */
import {type MouseEventHandler, useEffect, useState,} from 'react'
import {isModSub,} from '../../api/resources/modSubs'
import {
	getEntry,
	getLinkThings,
	getThingDomain,
	getThingDomainEl,
	getThingSubreddit,
	getThingTitleAnchor,
} from '../../dom/oldReddit/things'
import {collectMatches, getShredditPostDomain,} from '../../dom/shreddit/things'
import {
	provideLocation,
	refreshProvidedLocation,
	removeProvidedLocation,
	renderAtLocation,
} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import {AuthorButton,} from '../../shared/controls/AuthorButton'
import {colorNameToHex, getBestTextColor,} from '../../util/data/color'
import {forEachChunkedDynamic,} from '../../util/data/iter'
import createLogger from '../../util/infra/logging'
import {RedditPlatform,} from '../../util/infra/platform'
import {cleanSubredditName,} from '../../util/reddit/reddit-domain'
import {mountPopup,} from '../../util/ui/reactMount'
import {DomainTaggerPopup,} from './components/DomainTaggerPopup'
import {findTagForDomain,} from './matching'
import {getDomainTagsData, incrementDomainStat, saveDomainTag,} from './moduleapi'
import {type DomainTag, type DomainTagsData,} from './schema'
import {DomainTaggerSettings,} from './settings'

const log = createLogger('DTagger',)

/** Threshold-alert warning color shown on the indicator when the removal rate is too high. */
const THRESHOLD_WARNING_COLOR = '#ff6600'

/** Handlers returned by {@link createDomainTaggerHandlers} and wired up by the module entry point. */
export interface DomainTaggerHandlers {
	/** Adds the display-type CSS class to `document.body`. */
	applyDisplayClass: () => void
	/** Removes the display-type CSS class from `document.body`. */
	cleanup: () => Promise<void>
	/** Re-runs tag processing on all link things; called on page load and when new things appear (NER). */
	handleNewThings: () => void
	/**
	 * Opens the DomainTaggerPopup for the clicked "T" tag button.
	 * @param element The button element that was clicked.
	 * @param event The originating mouse event, used for popup positioning.
	 */
	handleTagButtonClick: (element: Element, event: MouseEvent,) => void | Promise<void>
	/** Processes all existing `shreddit-post` elements on the page. */
	initShreddit: () => void
	/**
	 * Processes newly added `shreddit-post` elements detected by a MutationObserver.
	 * @param mutations DOM mutation records to scan for new posts.
	 */
	handleShredditMutations: (mutations: MutationRecord[],) => void
}

/** Context data carried through the Shreddit thingDomainControls slot. */
interface ShredditDomainDetail {
	/** The configured display style for domain tags. */
	displayType: string
	/** Domain text shown in label-style display modes. */
	domain: string
	/** The matched domain tag, or null while config is still loading or no tag matched. */
	domainTag: DomainTag | null
	/** Whether to show approval/removal counts in the indicator. */
	showCounts: boolean
}

/**
 * Returns the effective indicator color for a tag: the threshold warning color when the
 * removal rate meets or exceeds the configured threshold, otherwise the tag color.
 * @param tag The matched domain tag.
 */
function effectiveIndicatorColor (tag: DomainTag,): string {
	if (
		tag.removalThreshold !== undefined
		&& tag.removalThreshold >= 0
		&& (tag.approvalCount + tag.removalCount) > 0
	) {
		const rate = tag.removalCount / (tag.approvalCount + tag.removalCount)
		if (rate >= tag.removalThreshold / 100) { return THRESHOLD_WARNING_COLOR }
	}
	return tag.color
}

/**
 * Renders a small `▲N ▼M` count badge next to the tag indicator when showCounts is on
 * and the tag has at least one recorded action.
 */
function CountBadge ({tag,}: {tag: DomainTag},) {
	if (!tag.approvalCount && !tag.removalCount) { return null }
	return (
		<span className="toolbox-dt-count-badge" title={`${tag.approvalCount} approved / ${tag.removalCount} removed`}>
			▲{tag.approvalCount}&nbsp;▼{tag.removalCount}
		</span>
	)
}

/**
 * Renders the clickable colored dot shown for the `title_dot` display style once a domain is
 * tagged. The dot stands in for the "T" edit button (clicking it reopens the tag popup), exposes
 * the tag note as a hover tooltip, and - when count display is enabled and the tag has recorded
 * actions - renders the approval/removal counts inside the dot as a colored pill.
 * @param tag The matched domain tag.
 * @param color The effective indicator color (threshold warning color or the tag color).
 * @param showCounts Whether approval/removal counts should be shown inside the dot.
 * @param onClick Click handler that opens the tag popup.
 */
function DomainTagDot ({tag, color, showCounts, onClick,}: {
	tag: DomainTag
	color: string
	showCounts: boolean
	onClick: (event: MouseEvent,) => void
},) {
	// `|| undefined` so an empty/absent note renders no `title` attribute at all.
	const title = tag.note || undefined
	const hasCounts = showCounts && Boolean(tag.approvalCount || tag.removalCount,)

	if (hasCounts) {
		return (
			<a
				className="toolbox-dt-dot toolbox-dt-dot-counts add-domain-tag"
				title={title}
				style={{backgroundColor: color, color: getBestTextColor(color,),}}
				onClick={(e,) => onClick(e.nativeEvent,)}
			>
				▲{tag.approvalCount}&nbsp;▼{tag.removalCount}
			</a>
		)
	}

	return (
		<a
			className="toolbox-dt-dot toolbox-dt-little-dot add-domain-tag"
			title={title}
			style={{color,}}
			onClick={(e,) => onClick(e.nativeEvent,)}
		>
			●
		</a>
	)
}

/**
 * Renders the Shreddit domain-tag indicator: a "T" edit button plus an optional visual
 * element (dot, label, or nothing) based on the display type and matched tag.
 *
 * Intentional: `post_border` and `post_title` apply styles to the `shreddit-post` element
 * itself (outside this component). For those modes only the "T" button is rendered here.
 */
function ShredditDomainIndicator ({detail, onButtonClick,}: {
	detail: ShredditDomainDetail
	onButtonClick: (event: MouseEvent,) => void
},) {
	const {displayType, domain, domainTag, showCounts,} = detail

	const button = (
		<a
			className="add-domain-tag toolbox-general-button"
			title="Color tag domains"
			onClick={(e,) => onButtonClick(e.nativeEvent,)}
		>
			T
		</a>
	)

	if (!domainTag || displayType === 'post_border' || displayType === 'post_title') {
		return <div className="toolbox-dt-shreddit-indicator">{button}</div>
	}

	const indicatorColor = effectiveIndicatorColor(domainTag,)
	const countBadge = showCounts ? <CountBadge tag={domainTag} /> : null

	switch (displayType) {
		case 'title_dot':
			// Once tagged, the colored dot replaces the "T" button: clicking the dot reopens the
			// popup, counts (if enabled) render inside the dot, and the note shows on hover.
			return (
				<div className="toolbox-dt-shreddit-indicator">
					<DomainTagDot
						tag={domainTag}
						color={indicatorColor}
						showCounts={showCounts}
						onClick={onButtonClick}
					/>
				</div>
			)
		case 'domain_background': {
			const textColor = getBestTextColor(indicatorColor,)
			return (
				<div className="toolbox-dt-shreddit-indicator">
					<span
						className="toolbox-dt-domain-text"
						title={domainTag.note}
						style={{
							backgroundColor: indicatorColor,
							color: textColor,
							padding: '0 1px 1px',
							borderRadius: '3px',
						}}
					>
						{domain}
					</span>
					{countBadge}
					{button}
				</div>
			)
		}
		case 'domain_border':
			return (
				<div className="toolbox-dt-shreddit-indicator">
					<span
						className="toolbox-dt-domain-text"
						title={domainTag.note}
						style={{border: `1px solid ${indicatorColor}`, padding: '0 1px', borderRadius: '3px',}}
					>
						{domain}
					</span>
					{countBadge}
					{button}
				</div>
			)
		default:
			return <div className="toolbox-dt-shreddit-indicator">{button}</div>
	}
}

/**
 * Renders the old-Reddit domain "T" button only when the current user moderates the thing's
 * subreddit. Domain tags are stored in subreddit config, so on non-moderated subs the button
 * would silently fail to save; gating here keeps it from appearing at all.
 *
 * `isModSub` is async, so the button is withheld until the (usually in-memory cached) check
 * resolves; missing/unknown subreddits never render the button.
 * @param subreddit The thing's subreddit, from the slot context.
 * @param onButtonClick Click handler forwarded to the rendered {@link AuthorButton}.
 */
function OldRedditDomainTagButton ({subreddit, onButtonClick,}: {
	subreddit: string | undefined
	onButtonClick: MouseEventHandler<HTMLButtonElement>
},) {
	const [isMod, setIsMod,] = useState(false,)

	useEffect(() => {
		if (!subreddit) { return }
		let active = true
		isModSub(subreddit,)
			.then((mod,) => {
				if (active) { setIsMod(mod,) }
			},)
			.catch(() => {},)
		return () => {
			active = false
		}
	}, [subreddit,],)

	if (!isMod) { return null }

	return (
		<AuthorButton
			className="add-domain-tag"
			title="Color tag domains"
			onClick={onButtonClick}
		>
			T
		</AuthorButton>
	)
}

/**
 * Creates and wires all Domain Tagger DOM handlers based on the current settings.
 * @param displayType Controls how the color tag is visually applied (dot, border, background, etc.).
 * @returns An object of handler functions to be bound to events by the module entry point.
 */
export function createDomainTaggerHandlers (
	{displayType,}: DomainTaggerSettings,
): DomainTaggerHandlers {
	const lifecycle = createLifecycle()

	// One mod-status MutationObserver per shreddit post. Keyed by the post element
	// so re-processing a post (which happens after every tag save) reuses the
	// existing observer instead of stacking another - N stacked observers would
	// fire N times on a single approval and inflate the wiki stat counter.
	const shredditObservers = new Map<Element, MutationObserver>()
	lifecycle.mount(() => {
		for (const observer of shredditObservers.values()) { observer.disconnect() }
		shredditObservers.clear()
	},)

	// Renders the "T" edit button (old Reddit) or the full indicator+button (Shreddit).
	// handleTagButtonClick is referenced here but assigned later in this closure; it is always
	// defined by the time any provider calls this renderer.
	renderAtLocation('thingDomainControls', {id: 'domaintagger.button', lifecycle,}, ({context, target,},) => {
		if (context.platform === RedditPlatform.Shreddit) {
			const detail = context.rawDetail as ShredditDomainDetail
			return (
				<ShredditDomainIndicator
					detail={detail}
					onButtonClick={(event,) => void handleTagButtonClick(target, event,)}
				/>
			)
		}
		return (
			<OldRedditDomainTagButton
				subreddit={context.subreddit}
				onButtonClick={(event,) => void handleTagButtonClick(event.currentTarget, event.nativeEvent,)}
			/>
		)
	},)

	// --- Old Reddit action detection ---
	// Delegate approve/remove button clicks to increment domain stats.
	lifecycle.delegate(
		document.body,
		'click',
		'.flat-list .approve-button .togglebutton, .big-mod-buttons > span > .pretty-button.positive',
		(el,) => {
			void recordModAction(el, 'approve',)
		},
	)
	lifecycle.delegate(
		document.body,
		'click',
		'.flat-list .remove-button .togglebutton, .big-mod-buttons > span > .pretty-button.negative',
		(el,) => {
			void recordModAction(el, 'remove',)
		},
	)

	/**
	 * Extracts domain and subreddit from the nearest `.thing` ancestor and calls
	 * {@link incrementDomainStat} if a tagged domain is found.
	 */
	async function recordModAction (el: Element, action: 'approve' | 'remove',) {
		const thing = el.closest('.thing',)
		if (!thing) { return }
		const domain = getThingDomain(thing,)
		const subredditName = getThingSubreddit(thing,)
		if (!domain || !subredditName) { return }
		const subreddit = cleanSubredditName(subredditName,)
		// Only track domains that already have a tag.
		const data = await getDomainTagsData(subreddit,)
		const match = findTagForDomain(domain, data.tags,)
		if (!match) { return }
		await incrementDomainStat(subreddit, domain, action,)
	}

	async function run () {
		log.debug('run called',)
		const things = getLinkThings().filter((t,) => !t.classList.contains('dt-processed',))

		const subs: Record<string, Element[]> = {}
		await Promise.all(
			things.map(async (thing,) => {
				const subreddit = getThingSubreddit(thing,)

				if (!subreddit || !await isModSub(subreddit,)) {
					thing.classList.add('dt-processed',)
					return
				}

				processThing(thing,)

				subs[subreddit] = subs[subreddit] || []
				subs[subreddit].push(thing,)
			},),
		)

		log.debug('Processing subreddits',)
		log.debug(Object.keys(subs,),)

		void forEachChunkedDynamic(Object.entries(subs,), ([subreddit, tags,],) => {
			void processSubreddit(subreddit, tags,)
		},)?.then(() => {
			log.debug('Done processing things',)
		},)
	}

	function processThing (thing: Element,) {
		thing.classList.add('dt-processed',)
	}

	async function processSubreddit (subreddit: string, things: Element[],) {
		log.debug(`  Processing subreddit: /r/${subreddit}`,)
		const data = await getDomainTagsData(subreddit,)
		log.debug(`    Domain tags retrieved for /r/${subreddit}`,)
		if (data.tags.length > 0) {
			setTags(data, things,)
		}
	}

	function setTags (data: DomainTagsData, things: Element[],) {
		log.debug('    Setting tags',)
		const {tags: domainTags, showCounts,} = data

		// Intentional vanilla DOM: style mutations target Reddit-owned domain/title/entry elements, not toolbox UI.
		// Returns true when the matched tag is shown via the injected dot (title_dot / fallback), in which
		// case the count badge is rendered inside the dot rather than as a separate sibling.
		function applyTag (domainEl: Element, d: DomainTag, entryEl: Element | null,): boolean {
			const color = effectiveIndicatorColor(d,)
			const hasCounts = showCounts && Boolean(d.approvalCount || d.removalCount,)
			domainEl.setAttribute('data-color', color,)
			if (d.note) { domainEl.setAttribute('title', d.note,) }

			switch (displayType) {
				case 'domain_background': {
					const textColor = getBestTextColor(color,)
					domainEl.classList.add(`toolbox-dt-bg-${color}`,)
					Object.assign((domainEl as HTMLElement).style, {
						backgroundColor: color,
						padding: '0 1px 1px',
						borderRadius: '3px',
						color: textColor,
					},)
					const anchor = domainEl.querySelector('a',)
					if (anchor) {
						anchor.style.color = textColor
					}
					break
				}
				case 'domain_border':
					Object.assign((domainEl as HTMLElement).style, {
						border: `1px solid ${color}`,
						padding: '0 1px',
						borderRadius: '3px',
					},)
					break
				case 'post_title': {
					const titleAnchor = entryEl ? getThingTitleAnchor(entryEl,) : null
					if (titleAnchor) {
						titleAnchor.style.color = color
					}
					break
				}
				case 'post_border':
					if (entryEl) {
						;(entryEl as HTMLElement).style.border = `3px solid ${color}`
					}
					break
				case 'title_dot':
				default: {
					// The injected dot is toolbox UI (cleaned up on teardown) and doubles as the edit
					// control: clicking it reopens the tag popup, so it replaces the "T" button. The
					// note shows on hover, and counts (when enabled) render inside the dot as a pill.
					let dot = domainEl.parentElement?.querySelector('.toolbox-dt-dot',) as HTMLElement | null
					if (!dot) {
						dot = document.createElement('span',)
						dot.className = 'toolbox-dt-dot add-domain-tag'
						domainEl.before(dot,)
						const created = dot
						created.onclick = (event,) => {
							void handleTagButtonClick(created, event,)
						}
						lifecycle.mount(() => created.remove())
					}
					dot.title = d.note ?? ''
					if (hasCounts) {
						dot.classList.remove('toolbox-dt-little-dot',)
						dot.classList.add('toolbox-dt-dot-counts',)
						dot.style.backgroundColor = color
						dot.style.color = getBestTextColor(color,)
						dot.textContent = `▲${d.approvalCount} ▼${d.removalCount}`
					} else {
						dot.classList.remove('toolbox-dt-dot-counts',)
						dot.classList.add('toolbox-dt-little-dot',)
						dot.style.backgroundColor = ''
						dot.style.color = color
						dot.textContent = '●'
					}
					return true
				}
			}

			// Count badge for old Reddit (injected as sibling text node, cleaned up on teardown).
			// Only the dot-based display styles fold counts into the indicator; the styles handled
			// above (domain text / post styling) still surface counts as a separate sibling badge.
			if (hasCounts) {
				const existingBadge = domainEl.parentElement?.querySelector('.toolbox-dt-count-badge',)
				if (!existingBadge) {
					const badge = document.createElement('span',)
					badge.className = 'toolbox-dt-count-badge'
					badge.title = `${d.approvalCount} approved / ${d.removalCount} removed`
					badge.textContent = `▲${d.approvalCount} ▼${d.removalCount}`
					domainEl.after(badge,)
					lifecycle.mount(() => badge.remove())
				}
			}
			return false
		}

		void forEachChunkedDynamic(things, (thing,) => {
			const entryEl = getEntry(thing,)
			const domainEl = getThingDomainEl(thing,)
			const domain = getThingDomain(thing,)
			if (!domain || !domainEl) {
				return
			}
			const match = findTagForDomain(domain, domainTags,)
			// The injected dot doubles as the edit control, so hide the slot's "T" button while it
			// is showing; restore it when no tag matches (or another display style is in use).
			const buttonSlot = domainEl.nextElementSibling
			const dotReplacesButton = match ? applyTag(domainEl, match, entryEl ?? null,) : false
			if (!match) {
				// A tag may have just been cleared: drop any dot left over from a previous pass.
				domainEl.parentElement?.querySelector('.toolbox-dt-dot',)?.remove()
			}
			if (buttonSlot?.classList.contains('toolbox-domain-controls',)) {
				;(buttonSlot as HTMLElement).style.display = dotReplacesButton ? 'none' : ''
			}
		},)
	}

	async function processShredditPost (postEl: Element,) {
		if (postEl.classList.contains('toolbox-dt-processed',)) {
			return
		}
		const subreddit = postEl.getAttribute('subreddit-name',) ?? ''
		if (!subreddit || !await isModSub(subreddit,)) {
			postEl.classList.add('toolbox-dt-processed',)
			return
		}
		postEl.classList.add('toolbox-dt-processed',)

		const domain = getShredditPostDomain(postEl,)
		if (domain) {
			;(postEl as HTMLElement).dataset.toolboxDomain = domain
		}

		// Provide the domain controls slot immediately so the "T" button appears while config loads.
		provideLocation('thingDomainControls', postEl, {
			platform: RedditPlatform.Shreddit,
			kind: 'post',
			subreddit,
			rawDetail: {
				displayType,
				domain: domain ?? '',
				domainTag: null,
				showCounts: false,
			} satisfies ShredditDomainDetail,
		}, {shadow: false,},)

		const data = await getDomainTagsData(subreddit,)
		if (data.tags.length && domain) {
			const matchedTag = findTagForDomain(domain, data.tags,)
			if (matchedTag) {
				const color = effectiveIndicatorColor(matchedTag,) // Store color in dataset so handleTagButtonClick can read it for the popup's initial color.
				;(postEl as HTMLElement).dataset.toolboxDtColor = color
				// post_border styles the post element itself via CSS; the indicator only shows the "T" button.
				if (displayType === 'post_border') {
					;(postEl as HTMLElement).style.setProperty('--toolbox-dt-color', color,)
					postEl.classList.add('toolbox-dt-post-border',)
				}
				// Refresh the slot context so the indicator component re-renders with the matched tag.
				refreshProvidedLocation('thingDomainControls', postEl, {
					platform: RedditPlatform.Shreddit,
					kind: 'post',
					subreddit,
					rawDetail: {
						displayType,
						domain,
						domainTag: matchedTag,
						showCounts: data.showCounts,
					} satisfies ShredditDomainDetail,
				}, {shadow: false,},)
			}
		}

		// Shreddit action detection: observe the post element for attribute/class changes
		// that indicate a moderator approved or removed the post.
		attachShredditActionObserver(postEl, subreddit, domain ?? '',)
	}

	/**
	 * Attaches a MutationObserver to a `shreddit-post` element that fires
	 * {@link incrementDomainStat} when its mod-action-related attributes change.
	 * The observer is cleaned up via the module lifecycle.
	 *
	 * Shreddit surfaces approval/removal state via the `mod-status` attribute
	 * (values: `"approved"`, `"removed"`, `"spam"`) and the `removed-by-category`
	 * attribute. We track the previous value to avoid double-counting on unrelated
	 * mutations and only fire when transitioning to a new non-empty status.
	 */
	function attachShredditActionObserver (postEl: Element, subreddit: string, domain: string,) {
		if (!domain) { return }
		// Already observing this post (a prior processing pass attached one); don't
		// stack a second observer that would double-count the same mod action.
		if (shredditObservers.has(postEl,)) { return }

		let lastStatus = postEl.getAttribute('mod-status',) ?? ''

		const observer = new MutationObserver((mutations,) => {
			void (async () => {
				for (const mutation of mutations) {
					if (mutation.type !== 'attributes') { continue }
					const newStatus = postEl.getAttribute('mod-status',) ?? ''
					if (newStatus === lastStatus || !newStatus) { continue }
					lastStatus = newStatus

					const data = await getDomainTagsData(subreddit,)
					const match = findTagForDomain(domain, data.tags,)
					if (!match) { continue }

					if (newStatus === 'approved') {
						await incrementDomainStat(subreddit, domain, 'approve',)
					} else if (newStatus === 'removed' || newStatus === 'spam') {
						await incrementDomainStat(subreddit, domain, 'remove',)
					}
				}
			})()
		},)

		observer.observe(postEl, {attributes: true, attributeFilter: ['mod-status',],},)
		shredditObservers.set(postEl, observer,)
	}

	/**
	 * Opens a {@link DomainTaggerPopup} through the shared popup registry, deduplicated
	 * per domain+subreddit: re-clicking the same domain's tag button reveals the live
	 * popup instead of mounting a duplicate, while tagging a different domain opens its own.
	 * @param opts Tag, subreddit, color, and a post-save callback.
	 * @param event The click event used to position the popup.
	 */
	function openTagPopup (
		{domain, subreddit, currentTag, onAfterSave,}: {
			domain: string
			subreddit: string
			currentTag: DomainTag | null
			onAfterSave: () => void
		},
		event: MouseEvent,
	) {
		mountPopup(
			(onClose,) => (
				<DomainTaggerPopup
					subreddit={subreddit}
					initialDomain={domain}
					initialColor={currentTag?.color ?? '#cee3f8'}
					{...(currentTag?.note !== undefined && {initialNote: currentTag.note,})}
					{...(currentTag?.removalThreshold !== undefined
						&& {initialThreshold: currentTag.removalThreshold,})}
					approvalCount={currentTag?.approvalCount ?? 0}
					removalCount={currentTag?.removalCount ?? 0}
					initialPosition={{top: event.pageY - 10, left: event.pageX - 50,}}
					onSave={(tag: DomainTag,) => {
						void (async () => {
							onClose()
							try {
								await saveDomainTag(subreddit, tag,)
							} catch (err: unknown) {
								log.debug(err,)
								return
							}
							onAfterSave()
						})()
					}}
					onClose={onClose}
				/>
			),
			undefined,
			`domaintagger:${subreddit}:${domain}`,
		)
	}

	const handleTagButtonClick: DomainTaggerHandlers['handleTagButtonClick'] = async (element, event,) => {
		// Shreddit path
		const shredditPost = element.closest('shreddit-post',)
		if (shredditPost) {
			const domain = (shredditPost as HTMLElement).dataset.toolboxDomain
			const subredditName = shredditPost.getAttribute('subreddit-name',)
			if (!domain || !subredditName) { return }
			const subreddit = cleanSubredditName(subredditName,)
			const data = await getDomainTagsData(subreddit,)
			const currentTag = findTagForDomain(domain, data.tags,)
			openTagPopup({
				domain,
				subreddit,
				currentTag,
				onAfterSave: () => {
					document.querySelectorAll('shreddit-post.toolbox-dt-processed',).forEach((el,) => {
						el.classList.remove('toolbox-dt-processed',)
						el.classList.remove('toolbox-dt-post-border',)
						;(el as HTMLElement).style.removeProperty('--toolbox-dt-color',)
						;(el as HTMLElement).dataset.toolboxDtColor = ''
						removeProvidedLocation(el, 'thingDomainControls',)
					},)
					document.querySelectorAll('shreddit-post',).forEach((el,) => {
						void processShredditPost(el,)
					},)
				},
			}, event,)
			return
		}

		// Old Reddit path
		const domainEl = element.parentElement?.querySelector('.domain',)
		const thing = element.closest('.thing',)
		if (!thing) { return }
		const domain = getThingDomain(thing,)
		const subredditName = getThingSubreddit(thing,)
		if (!domain || !subredditName) { return }
		const subreddit = cleanSubredditName(subredditName,)
		const data = await getDomainTagsData(subreddit,)
		const currentTag = findTagForDomain(domain, data.tags,)
		openTagPopup({
			domain,
			subreddit,
			currentTag: currentTag ?? {
				name: domain,
				color: colorNameToHex(domainEl?.getAttribute('data-color',) || '#cee3f8',),
				approvalCount: 0,
				removalCount: 0,
			},
			onAfterSave: () => {
				getLinkThings()
					.filter((el,) => el.classList.contains('dt-processed',))
					.forEach((el,) => el.classList.remove('dt-processed',))
				void run()
			},
		}, event,)
	}

	return {
		applyDisplayClass () {
			document.body.classList.add(`toolbox-dt-type-${displayType}`,)
		},

		cleanup () {
			document.body.classList.remove(`toolbox-dt-type-${displayType}`,)
			return lifecycle.cleanup()
		},

		handleNewThings () {
			log.debug('run called from NER support',)
			void run()
		},

		initShreddit () {
			document.querySelectorAll('shreddit-post',).forEach((el,) => {
				void processShredditPost(el,)
			},)
		},

		handleShredditMutations (mutations: MutationRecord[],) {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (!(node instanceof Element)) { continue }
					for (const el of collectMatches(node, 'shreddit-post',)) {
						void processShredditPost(el,)
					}
				}
			}
		},

		handleTagButtonClick,
	}
}
