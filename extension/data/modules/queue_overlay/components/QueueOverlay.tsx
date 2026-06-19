/** Queue overlay component that displays old-Reddit mod queues inside an iframe-based overlay window. */
import {useEffect, useRef, useState,} from 'react'

import {Icon,} from '../../../shared/controls/Icon'
import {Backdrop,} from '../../../shared/window/Backdrop'
import {Window,} from '../../../shared/window/Window'
import store from '../../../store'
import {startSpinner, stopSpinner,} from '../../../store/spinnerSlice'
import {purify,} from '../../../util/data/purify'
import {link,} from '../../../util/reddit/pageContext'
import {mountReactInBody,} from '../../../util/ui/reactMount'

import {QueueBaseUrls, QueueOverlayHandle, QueueType,} from '../schema'
import css from './QueueOverlay.module.css'

/** Props for the QueueOverlay component. */
interface QueueOverlayProps {
	/** Which queue tab to show first. */
	initialType: QueueType
	/** When provided, scopes the initial queue to this subreddit instead of the multi-sub default. */
	initialSubreddit?: string | undefined
	/** Base subreddit lists used to build default queue URLs for each queue type. */
	baseUrls: QueueBaseUrls
	onClose: () => void
	/** Ref populated with the overlay's imperative handle after the first render. */
	instanceRef?: {current: QueueOverlayHandle | null}
}

const tabDefs: {key: QueueType; title: string; tooltip: string}[] = [
	{key: 'modqueue', title: 'modqueue', tooltip: 'Moderation queue.',},
	{key: 'unmoderated', title: 'unmoderated', tooltip: 'Unmoderated posts.',},
	{key: 'reports', title: 'reports', tooltip: 'reports.',},
	{key: 'spam', title: 'spam', tooltip: 'spam.',},
	{key: 'edited', title: 'edited', tooltip: 'edited.',},
]

/** Runtime state for a single queue type tab. */
interface TabState {
	/** Whether this tab has been loaded at least once (i.e. the iframe src has been set). */
	initialized: boolean
	/** Current value of the subreddit/multi input field for this tab. */
	multiInput: string
	/** The URL currently loaded in this tab's iframe. */
	listUrl: string
	/** Whether the iframe is currently loading. */
	loading: boolean
}

function emptyTabState (): TabState {
	return {initialized: false, multiInput: '', listUrl: '', loading: false,}
}

function computeListUrlAndMulti (
	type: QueueType,
	baseUrls: QueueBaseUrls,
	subreddit?: string,
): {listUrl: string; multi: string} {
	if (subreddit) {
		return {listUrl: `/r/${subreddit}/about/${type}`, multi: subreddit,}
	}
	return {
		listUrl: `/r/${baseUrls[type].subreddits}/about/${type}/`,
		multi: baseUrls[type].subreddits,
	}
}

function QueueOverlay ({initialType, initialSubreddit, baseUrls, onClose, instanceRef,}: QueueOverlayProps,) {
	const [activeType, setActiveType,] = useState<QueueType>(initialType,)
	const [tabStates, setTabStates,] = useState<Record<QueueType, TabState>>({
		modqueue: emptyTabState(),
		unmoderated: emptyTabState(),
		reports: emptyTabState(),
		spam: emptyTabState(),
		edited: emptyTabState(),
	},)
	const iframeRefs = useRef<Record<QueueType, HTMLIFrameElement | null>>({
		modqueue: null,
		unmoderated: null,
		reports: null,
		spam: null,
		edited: null,
	},)
	const subredditRef = useRef<string | undefined>(initialSubreddit,)
	// Mirror tabStates into a ref so the imperative-API effect below can read the latest
	// value without re-subscribing (and reassigning instanceRef.current) on every render.
	const tabStatesRef = useRef(tabStates,)
	tabStatesRef.current = tabStates

	function ensureTabLoaded (
		type: QueueType,
		options?: {forceReload?: boolean | undefined; subreddit?: string | undefined},
	) {
		const subreddit = options?.subreddit ?? subredditRef.current
		setTabStates((prev,) => {
			const existing = prev[type]
			if (existing.initialized && !options?.forceReload) { return prev }
			const {listUrl, multi,} = computeListUrlAndMulti(type, baseUrls, subreddit,)
			store.dispatch(startSpinner(),)
			return {
				...prev,
				[type]: {
					initialized: true,
					multiInput: multi,
					listUrl,
					loading: true,
				},
			}
		},)
	}

	function reloadFromInput (type: QueueType,) {
		const state = tabStates[type]
		const multi = purify(state.multiInput,)
		const newUrl = `/r/${multi}/about/${type}/`
		store.dispatch(startSpinner(),)
		setTabStates((prev,) => ({
			...prev,
			[type]: {...prev[type], listUrl: newUrl, loading: true,},
		}))
	}

	// Mount: load initial tab.
	useEffect(() => {
		ensureTabLoaded(initialType, {subreddit: initialSubreddit,},)
	}, [],)

	// Tab switch: ensure target tab is loaded.
	useEffect(() => {
		ensureTabLoaded(activeType,)
	}, [activeType,],)

	// Expose imperative API to outside callers (e.g., modbar buttons).
	useEffect(() => {
		if (!instanceRef) { return }
		instanceRef.current = {
			setType: (type, options,) => {
				if (options?.subreddit !== undefined) {
					subredditRef.current = options.subreddit
				}
				if (options?.overwrite && tabStatesRef.current[type].initialized) {
					ensureTabLoaded(type, {forceReload: true, subreddit: options.subreddit,},)
				} else {
					ensureTabLoaded(type, {subreddit: options?.subreddit,},)
				}
				setActiveType(type,)
			},
		}
		return () => {
			if (instanceRef) { instanceRef.current = null }
		}
	}, [instanceRef,],)

	return (
		<Backdrop onClickOutside={onClose}>
			<Window
				title="Toolbox-NXG queues"
				className={`toolbox-queue-overlay ${css.window}`}
				onClose={onClose}
			>
				<div className={css.body}>
					<div className={css.tabs}>
						{tabDefs.map((t,) => (
							<a
								key={t.key}
								title={t.tooltip}
								className={`${css.tab} ${activeType === t.key ? css.tabActive : ''}`}
								onClick={() => setActiveType(t.key,)}
							>
								{t.title}
							</a>
						))}
					</div>
					<div className={css.tabContent}>
						{tabDefs.map((t,) => {
							const state = tabStates[t.key]
							const visible = activeType === t.key
							if (!state.initialized) { return null }
							return (
								<div
									key={t.key}
									className={`toolbox-window-tab ${t.key}`}
									style={{
										display: visible ? 'flex' : 'none',
										flexDirection: 'column',
										height: '100%',
									}}
								>
									<div className="toolbox-queue-options">
										<input
											type="text"
											className="toolbox-input toolbox-queue-url"
											value={state.multiInput}
											onChange={(event,) =>
												setTabStates((prev,) => ({
													...prev,
													[t.key]: {...prev[t.key], multiInput: event.target.value,},
												}))}
											onKeyUp={(event,) => {
												if (event.key === 'Enter' && !state.loading) { reloadFromInput(t.key,) }
											}}
										/>
										<span
											className={`toolbox-icons toolbox-queue-reload ${
												state.loading ? 'loading' : ''
											} ${css.reloadButton}`}
											onClick={() => {
												if (!state.loading) { reloadFromInput(t.key,) }
											}}
											title="reload"
										>
											<Icon icon="refresh" />
										</span>
									</div>
									<iframe
										ref={(element,) => {
											iframeRefs.current[t.key] = element
										}}
										className="toolbox-queue-iframe"
										src={`${link(state.listUrl,)}?embedded=true`}
										onLoad={() => {
											store.dispatch(stopSpinner(),)
											setTabStates((prev,) => ({
												...prev,
												[t.key]: {...prev[t.key], loading: false,},
											}))
										}}
									/>
								</div>
							)
						},)}
					</div>
				</div>
			</Window>
		</Backdrop>
	)
}

let currentHandle: QueueOverlayHandle | null = null
// Liveness signal for the open overlay: the mounted component sets `.current` on
// mount and nulls it on unmount. A non-null `currentHandle` whose ref is null is a
// stale proxy (e.g. the React tree was torn down without running `cleanup`).
let currentInstanceRef: {current: QueueOverlayHandle | null} | null = null
// Teardown for the open overlay, so a stale mount can be disposed before remounting.
let currentCleanup: (() => void) | null = null

/**
 * Shows the QueueOverlay, or updates the already-visible instance to the requested type.
 * @param props Overlay props (without `onClose` and `instanceRef`, which are managed internally).
 * @returns A handle that allows external callers to switch the active queue type.
 */
export function showQueueOverlay (props: Omit<QueueOverlayProps, 'onClose' | 'instanceRef'>,): QueueOverlayHandle {
	// Retarget the open overlay only when its React instance is still mounted; a
	// handle delegating to a dead ref would silently no-op, so fall through to a
	// fresh mount instead.
	if (currentHandle && currentInstanceRef?.current) {
		currentHandle.setType(props.initialType, {
			subreddit: props.initialSubreddit,
			overwrite: true,
		},)
		return currentHandle
	}
	// Dispose any stale mount left behind before creating a new one.
	currentCleanup?.()
	const instanceRef = {current: null as QueueOverlayHandle | null,}
	let mounted: {host: HTMLElement; unmount: () => void} | null = null
	const cleanup = () => {
		mounted?.unmount()
		mounted = null
		currentHandle = null
		currentInstanceRef = null
		currentCleanup = null
	}
	mounted = mountReactInBody(<QueueOverlay {...props} onClose={cleanup} instanceRef={instanceRef} />,)
	// The handle is set via the useEffect above on first render.
	// We return a proxy that delegates through the instanceRef.
	const handle: QueueOverlayHandle = {
		setType: (type, options,) => instanceRef.current?.setType(type, options,),
	}
	currentHandle = handle
	currentInstanceRef = instanceRef
	currentCleanup = cleanup
	return handle
}
