/**
 * Comment Triage UI component and handler factory: scores, annotates, sorts, and collapses
 * comments by controversy and score to surface the most important comments first.
 */
import {useEffect, useState,} from 'react'

import {getCurrentUser,} from '../../api/resources/me'
import {renderAtLocation,} from '../../dom/uiLocations'

import {GeneralButton,} from '../../shared/controls/GeneralButton'
import {Icon,} from '../../shared/controls/Icon'
import {ModbarButton,} from '../../shared/controls/ModbarButton'
import {ShadowPortal,} from '../../shared/window/ShadowPortal'
import type {CommentTriageAdapter,} from './platformInterface'
import type {CommentTriageSettings,} from './settings'

import css from './CommentTriageDrawer.module.css'

/** Handlers returned by `createCommentTriageHandlers` for wiring into the module lifecycle. */
export interface CommentTriageHandlers {
	/** Injects the CommentTriageDrawer into the modbar and returns a cleanup function. */
	inject: () => () => void
	/** Processes newly loaded comment things when `TBNewThings` fires, if triage has been started. */
	handleNewThings: () => void
	/** Queues a re-sort of the relevant container when a "load more" element is clicked. */
	handleMoreChildrenClick: (element: Element,) => void
}

/** Props for the CommentTriageDrawer component. */
interface CommentTriageDrawerProps {
	/** Whether to automatically start highlighting when the component mounts. */
	highlightAuto: boolean
	/** Called when the user starts triage (scores and annotates comments). */
	onStart: () => void
	/** Called when the user requests a manual sort of the comment tree. */
	onSort: () => void
	/** Called when the user collapses non-drama comments. */
	onCollapse: () => void
	/** Called when the user expands all non-drama comments. */
	onExpand: () => void
}

function CommentTriageDrawer ({highlightAuto, onStart, onSort, onCollapse, onExpand,}: CommentTriageDrawerProps,) {
	const [drawerOpen, setDrawerOpen,] = useState(false,)
	const [started, setStarted,] = useState(highlightAuto,)
	const [collapsed, setCollapsed,] = useState(false,)

	useEffect(() => {
		if (highlightAuto) { onStart() }
	}, [],)

	const handleStart = () => {
		setStarted(true,)
		onStart()
	}

	const handleCollapseToggle = () => {
		if (collapsed) {
			onExpand()
		} else {
			onCollapse()
		}
		setCollapsed((c,) => !c)
	}

	return (
		<>
			<ModbarButton onClick={() => setDrawerOpen((o,) => !o)}>
				Comment Triage
			</ModbarButton>
			{drawerOpen && (
				<ShadowPortal>
					<div className={css.drawer}>
						<div className={css.header}>
							<span>Comment Triage</span>
							<button
								type="button"
								aria-label="Close"
								className={css.closeButton}
								onClick={() => setDrawerOpen(false,)}
							>
								<Icon icon="close" />
							</button>
						</div>
						<div className={css.content}>
							{!started
								? (
									<div className={css.buttons}>
										<GeneralButton onClick={handleStart}>Start</GeneralButton>
									</div>
								)
								: (
									<>
										<div className={css.buttons}>
											<GeneralButton onClick={onSort}>Sort</GeneralButton>
											<GeneralButton onClick={handleCollapseToggle}>
												{collapsed ? 'Expand' : 'Collapse'}
											</GeneralButton>
										</div>
										<div className={css.legend}>
											<div className={css.legendItem}>
												<span className={`${css.legendSwatch} ${css.swatchControversy}`} />
												controversial
											</div>
											<div className={css.legendItem}>
												<span className={`${css.legendSwatch} ${css.swatchNeg}`} />
												negative score
											</div>
											<div className={css.legendItem}>
												<span className={`${css.legendSwatch} ${css.swatchBoth}`} />
												both
											</div>
										</div>
									</>
								)}
						</div>
					</div>
				</ShadowPortal>
			)}
		</>
	)
}

/**
 * Creates the Comment Triage feature handlers: scoring, annotation, sorting, and collapse/expand.
 * @param settings Triage settings (all except `sortOnMoreChildren`, which is handled in the module).
 * @param adapter The platform adapter used for all DOM interactions.
 * @returns Handlers for injection, new-things events, and more-children clicks.
 */
export function createCommentTriageHandlers (
	{
		negHighlightThreshold,
		highlightControversy,
		expandOnLoad,
		highlightAuto,
		displayNChildren,
		displayNChildrenTop,
	}: Omit<CommentTriageSettings, 'sortOnMoreChildren'>,
	adapter: CommentTriageAdapter,
): CommentTriageHandlers {
	let sorted = false
	let pending: Array<() => void> = []
	let started = false

	/** Walks the comment tree upward from `el`, adding `className` to every ancestor comment. */
	function addClassToParents (el: Element, className: string,) {
		let parent = adapter.getParentComment(el,)
		while (parent) {
			parent.classList.add(className,)
			parent = adapter.getParentComment(parent,)
		}
	}

	/** Selects all elements matching `selector` within `container` and prepends them in order. */
	function prependMatching (container: Element, selector: string,) {
		const els = Array.from(container.querySelectorAll(selector,),)
		if (els.length) {
			container.prepend(...els,)
		}
	}

	function run () {
		const things = adapter.findNewComments()

		highlightComments(things,)

		while (pending.length) {
			pending.pop()!()
		}

		if (expandOnLoad) {
			const sel = adapter.commentSelector
			document.querySelectorAll(`${sel}.toolbox-controversy, ${sel}.toolbox-ncontroversy:not(.toolbox-pc-proc)`,)
				.forEach((el,) => adapter.uncollapse(el,))
		}

		things.forEach((el,) => adapter.markProcessed(el,))
	}

	function highlightComments (things: Element[],) {
		things.forEach((thing,) => {
			const childCount = adapter.readChildCount(thing,)
			if (childCount !== null && thing instanceof HTMLElement) {
				thing.dataset.nchildren = String(childCount,)
			}
			scoreAndAnnotate(thing,)
		},)

		if (highlightControversy) {
			things.filter((t,) => adapter.isControversial(t,)).forEach((t,) => {
				t.querySelector(':scope > .entry',)?.classList.add('toolbox-controversy',)
				addClassToParents(t, 'toolbox-controversy',)
			},)
		}
	}

	async function scoreAndAnnotate (thing: Element,) {
		let thresh = negHighlightThreshold

		const authorHref = adapter.getAuthorHref(thing,)
		if (authorHref && RegExp(`/${await getCurrentUser()}\\b`,).test(authorHref,)) {
			;--thresh
		}

		const score = adapter.readScore(thing,)
		if (score !== null && thing instanceof HTMLElement) {
			thing.dataset.score = String(score,)
			if (score <= thresh) {
				thing.classList.add('toolbox-neg', 'toolbox-ncontroversy',)
				addClassToParents(thing, 'toolbox-ncontroversy',)
			}
		}
	}

	function sortMe (container: Element,) {
		adapter.preSortFixup(container,)

		const children = adapter.getDirectChildren(container,)
		children.sort((a, b,) => (Number(b.dataset.nchildren,) || 0) - (Number(a.dataset.nchildren,) || 0))

		if (children.length) {
			container.prepend(...children,)
		}
		const sel = adapter.commentSelector
		prependMatching(container, `:scope > ${sel}.toolbox-controversy`,)
		prependMatching(container, `:scope > ${sel}.toolbox-ncontroversy`,)

		children.forEach((thing,) => {
			const child = adapter.getChildContainer(thing,)
			if (child) { sortMe(child,) }
		},)
	}

	function collapseNonDrama () {
		const sel = adapter.commentSelector
		const dramaEls = Array.from(
			document.querySelectorAll(`${sel}.toolbox-controversy, ${sel}.toolbox-ncontroversy`,),
		)
		dramaEls.forEach((el,) => adapter.uncollapse(el,))

		const root = adapter.getRootContainer()
		const dramaContainers = dramaEls
			.map((el,) => adapter.getChildContainer(el,))
			.filter((el,): el is Element => el !== null)

		const containers = [
			...(root ? [root,] : []),
			...dramaContainers,
		]

		containers.forEach((container,) => {
			container.querySelectorAll(`:scope > ${sel}:not(.toolbox-controversy):not(.toolbox-ncontroversy)`,)
				.forEach((el,) => adapter.collapse(el,))
		},)
	}

	function expandNonDrama () {
		const sel = adapter.commentSelector
		document.querySelectorAll(`${sel}:not(.toolbox-controversy):not(.toolbox-ncontroversy)`,)
			.forEach((el,) => adapter.uncollapse(el,))
	}

	function start () {
		started = true

		document.body.classList.add('toolbox-comment-triage',)
		if (highlightControversy) {
			document.body.classList.add('toolbox-controversy-hl',)
		}
		if (displayNChildren) {
			document.body.classList.add('toolbox-nchildren',)
		}
		if (displayNChildrenTop) {
			document.body.classList.add('toolbox-nchildrentop',)
		}

		run()

		if (expandOnLoad) {
			const sel = adapter.commentSelector
			document.querySelectorAll(`${sel}.toolbox-controversy, ${sel}.toolbox-ncontroversy`,)
				.forEach((el,) => adapter.uncollapse(el,))
		}
	}

	function inject (): () => void {
		return renderAtLocation(
			'modbar',
			{id: 'comment.triage', order: 3,},
			() => (
				<CommentTriageDrawer
					highlightAuto={highlightAuto}
					onStart={start}
					onSort={() => {
						sorted = true
						const container = adapter.getRootContainer()
						if (container) { sortMe(container,) }
					}}
					onCollapse={collapseNonDrama}
					onExpand={expandNonDrama}
				/>
			),
		)
	}

	function handleNewThings () {
		if (!started) { return }
		run()
	}

	function handleMoreChildrenClick (element: Element,) {
		if (!sorted) { return }
		const container = adapter.getMoreChildrenContainer(element,)
		if (container) {
			pending.push(() => sortMe(container,))
		}
	}

	return {inject, handleNewThings, handleMoreChildrenClick,}
}
