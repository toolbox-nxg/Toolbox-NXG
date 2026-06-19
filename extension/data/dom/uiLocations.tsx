/**
 * Platform-independent UI location registry.
 *
 * Modules call renderAtLocation() to contribute React UI into a named semantic
 * slot. Platform-specific DOM code calls provideLocation() whenever a concrete
 * Reddit DOM target is discovered, supplying context extracted from that target.
 *
 * The two halves are decoupled: renderers may be registered before any provider
 * exists, and providers may exist before any renderer is registered. Both orderings
 * converge to the same rendered output.
 */

import {Fragment, ReactNode, useEffect, useReducer,} from 'react'

import {type Lifecycle,} from '../framework/lifecycle'
import {RedditPlatform,} from '../util/infra/platform'
import {mountToTarget,} from '../util/ui/reactMount'

// -- Types ---------------------------------------------------------------------

export type UILocation =
	| 'authorActions'
	| 'thingActions'
	| 'thingDetails'
	| 'thingDomainControls'
	/**
	 * The flat-list button row on a thing.
	 * Old Reddit: `[flat-list buttons]` span in the action links area, after the flair button.
	 * Shreddit: a `toolbox-flat-list-slot` span rendered on its own full-width line below the
	 * post/comment - appended to the post's thing container, or inserted immediately before a
	 * comment's `shreddit-comment-action-row` (see `modules/shreddit/dom.ts`).
	 */
	| 'thingFlatListActions'
	/** Comment tagline status indicator area (author/score/time row). */
	| 'thingTaglineStatus'
	/** Old Reddit only: the action-link `<li>` immediately after a top-level comment's distinguish toggle. */
	| 'commentDistinguishControls'
	| 'thingNativeActionReplacement'
	| 'commentThreadControls'
	| 'commentComposerControls'
	/** Old Reddit only: toolbar above the queue listing. */
	| 'queueToolbar'
	/** Old Reddit only: per-thing selection slot in a queue listing. */
	| 'queueThingSelection'
	/** Old Reddit only: controls in the queue tab bar. */
	| 'queueTabControls'
	| 'wikiEditorControls'
	| 'stylesheetEditorControls'
	| 'userTextControls'
	| 'modmailComposerControls'
	| 'contentMenuControls'
	| 'sidebarControls'
	| 'modbar'
	| 'modbarContent'
	/** Inside the modbar's right-aligned counter group, before the modmail icon. */
	| 'modbarCounters'
	| 'modLogControls'

export type UILocationKind =
	| 'post'
	| 'comment'
	| 'user'
	| 'queue'
	| 'queueTab'
	| 'commentThread'
	| 'commentComposer'
	| 'wikiEditor'
	| 'stylesheetEditor'
	| 'userText'
	| 'modmailComposer'
	| 'sidebar'
	| 'thingNativeAction'
	| 'modbar'
	| 'overlay'
	| 'page'

/** Contextual data about the Reddit DOM location provided to each registered renderer. */
export interface UILocationContext {
	platform: RedditPlatform
	kind: UILocationKind
	author?: string
	subreddit?: string
	thingId?: string
	postId?: string
	commentId?: string
	permalink?: string
	/** True when the thing has been removed. */
	isRemoved?: boolean
	/** Page type string from `TBPageContext` (e.g. `'queueListing'`). */
	pageType?: string
	/** Raw platform-specific detail object for advanced use cases. */
	rawDetail?: unknown
}

/** Arguments passed to each renderer function registered via `renderAtLocation`. */
export interface UILocationRenderArgs {
	context: UILocationContext
	/** The concrete DOM element that is providing this location. */
	target: Element
}

/** Options for registering a renderer via `renderAtLocation`. */
export interface RegisterLocationRendererOptions {
	/** Unique identifier for this renderer; used for deduplication. */
	id: string
	/** When provided, the renderer is automatically unregistered when the lifecycle is cleaned up. */
	lifecycle?: Lifecycle
	/** Render order relative to other renderers at the same location; lower values render first. */
	order?: number
}

export interface ProvideLocationOptions {
	/** Passed to mountToTarget for idempotent re-provision. */
	key?: string
	/** false = light DOM; use for old Reddit <ul> lists and form button rows. Default true. */
	shadow?: boolean
	/**
	 * HTML tag for the Toolbox host element. Default 'div'.
	 * Use 'li' when providing into a Reddit <ul> flat-list button row so the host
	 * element is valid HTML inside a list.
	 */
	hostTag?: string
}

// -- Renderer registry ---------------------------------------------------------

interface RendererRecord {
	render: (args: UILocationRenderArgs,) => ReactNode | null
	order: number
}

const rendererRegistry = new Map<UILocation, Map<string, RendererRecord>>()
const locationListeners = new Map<UILocation, Set<() => void>>()

function notifyLocationRenderers (location: UILocation,) {
	for (const listener of locationListeners.get(location,) ?? []) {
		listener()
	}
}

function subscribeToLocationRenderers (location: UILocation, listener: () => void,): () => void {
	if (!locationListeners.has(location,)) {
		locationListeners.set(location, new Set(),)
	}
	locationListeners.get(location,)!.add(listener,)
	return () => {
		locationListeners.get(location,)?.delete(listener,)
	}
}

// -- React component -----------------------------------------------------------

/** Props for the LocationRenderers React component. */
export interface LocationRenderersProps {
	location: UILocation
	context: UILocationContext
	target: Element
}

/**
 * Renders all registered renderers for `location` into the current React tree.
 *
 * Use this when the host is itself a Toolbox-owned React component (e.g. the
 * modbar) and you want to avoid creating a separate React root. The `target`
 * element is passed unchanged to each renderer as `UILocationRenderArgs.target`.
 */
export function LocationRenderers ({location, context, target,}: LocationRenderersProps,) {
	const [, update,] = useReducer((x: number,) => x + 1, 0,)

	useEffect(() => subscribeToLocationRenderers(location, update,), [location,],)

	const renderers = Array.from(rendererRegistry.get(location,)?.entries() ?? [],)
		.sort(([, a,], [, b,],) => a.order - b.order)

	return (
		<>
			{renderers.map(([id, {render,},],) => {
				const node = render({context, target,},)
				if (node == null) { return null }
				return <Fragment key={id}>{node}</Fragment>
			},)}
		</>
	)
}

// -- Provider registry ---------------------------------------------------------

interface ProviderRecord {
	cleanup: () => void
}

// target element -> (location -> provider record)
const providerRegistry = new Map<Element, Map<UILocation, ProviderRecord>>()

// -- Public API ----------------------------------------------------------------

/**
 * Register a React renderer for a named UI location.
 *
 * The renderer is called once per active provider for `location`. When the
 * renderer returns null, it contributes nothing for that provider instance.
 *
 * Returns a cleanup function that unregisters the renderer.
 */
export function renderAtLocation (
	location: UILocation,
	options: RegisterLocationRendererOptions,
	render: (args: UILocationRenderArgs,) => ReactNode | null,
): () => void {
	const {id, lifecycle, order = 0,} = options

	if (!rendererRegistry.has(location,)) {
		rendererRegistry.set(location, new Map(),)
	}
	rendererRegistry.get(location,)!.set(id, {render, order,},)
	notifyLocationRenderers(location,)

	const unregister = () => {
		rendererRegistry.get(location,)?.delete(id,)
		notifyLocationRenderers(location,)
	}

	lifecycle?.mount(unregister,)
	return unregister
}

/**
 * Declare that a concrete Reddit DOM target provides a named UI location.
 *
 * Creates a Toolbox host element appended to `target` and mounts a React root
 * that renders all registered renderers for `location`. Renderers added or
 * removed later automatically reflect in the mounted React root.
 *
 * Call the returned cleanup to unmount the React root and remove the host.
 */
export function provideLocation (
	location: UILocation,
	target: Element,
	context: UILocationContext,
	options: ProvideLocationOptions = {},
): () => void {
	const {key, shadow = true, hostTag = 'div',} = options

	if (!providerRegistry.has(target,)) {
		providerRegistry.set(target, new Map(),)
	}
	const targetProviders = providerRegistry.get(target,)!

	// Idempotent re-provision: tear down any existing provider for this location.
	targetProviders.get(location,)?.cleanup()

	const reactCleanup = mountToTarget(
		<LocationRenderers location={location} context={context} target={target} />,
		target,
		{key: key ?? `toolbox-ui-location-${location}`, shadow, hostTag, name: `uiLocation(${location})`,},
	)

	const cleanup = () => {
		reactCleanup()
		targetProviders.delete(location,)
		if (targetProviders.size === 0) {
			providerRegistry.delete(target,)
		}
	}

	targetProviders.set(location, {cleanup,},)
	return cleanup
}

/**
 * Remove a provided location (or all locations) from a target element.
 *
 * If `location` is omitted, removes all provided locations for the target.
 */
export function removeProvidedLocation (target: Element, location?: UILocation,): void {
	const targetProviders = providerRegistry.get(target,)
	if (!targetProviders) { return }

	if (location) {
		targetProviders.get(location,)?.cleanup()
	} else {
		for (const record of targetProviders.values()) {
			record.cleanup()
		}
	}
}

/**
 * Re-trigger provider logic for a target element.
 *
 * Providers that are driven by `LocationRenderers` respond to renderer registry
 * changes automatically, so this is only needed when the *context* passed to
 * `provideLocation` has changed and the provider should be re-created with new
 * context data.
 */
export function refreshProvidedLocation (
	location: UILocation,
	target: Element,
	context: UILocationContext,
	options?: ProvideLocationOptions,
): () => void {
	return provideLocation(location, target, context, options,)
}
