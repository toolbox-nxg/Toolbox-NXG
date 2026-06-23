/** Adds sticky/unsticky action buttons to post listing items on old Reddit. */
import {useEffect, useState,} from 'react'

import {getSubredditListing,} from '../../../api/resources/subreddits'
import {getThingFullname, getThingSubreddit, getThingSubredditName,} from '../../../dom/oldReddit/things'
import {renderAtLocation,} from '../../../dom/uiLocations'
import createLogger from '../../../util/infra/logging'
import {proposeOrSticky, proposeOrUnsticky,} from '../../shared/proposals/gateway'

const log = createLogger('BButtons',)

/** Interaction state for the sticky button. */
type StickyState = 'idle' | 'success' | 'error'

/** Props for the StickyButton component. */
interface StickyButtonProps {
	/** The listing item DOM element this button acts on. */
	thing: Element
}

// Caches, per subreddit, whether that subreddit currently has at least one sticky
// (i.e. whether slot 1 is occupied). A listing can hold many things from the same
// subreddit, so probing once per subreddit avoids redundant API calls.
const subStickyCache = new Map<string, Promise<boolean>>()

/**
 * Resolves true when the subreddit currently has at least one sticky (slot 1 occupied).
 * Reddit only permits stickying into slot 2 when slot 1 is already taken, so this is the
 * precondition for offering a "sticky slot 2" action.
 * @param subreddit The subreddit name (without the `r/` prefix).
 */
function subredditHasSticky (subreddit: string,): Promise<boolean> {
	let cached = subStickyCache.get(subreddit,)
	if (!cached) {
		// /r/<sub>/about/sticky?num=1 resolves to the slot-1 sticky listing, or rejects (404)
		// when the subreddit has no sticky at all.
		cached = getSubredditListing(subreddit, 'sticky', {num: '1',},).then(() => true, () => false,)
		subStickyCache.set(subreddit, cached,)
	}
	return cached
}

/** Records that a subreddit now has a sticky, so subsequently-rendered buttons offer slot 2. */
function markSubredditHasSticky (subreddit: string,) {
	subStickyCache.set(subreddit, Promise.resolve(true,),)
}

/**
 * Returns the subreddit a thing belongs to, preferring the `data-subreddit` attribute and
 * falling back to the subreddit link text. Returns `null` when neither is present.
 */
function resolveSubreddit (thing: Element,): string | null {
	return getThingSubreddit(thing,) ?? getThingSubredditName(thing,)
}

/**
 * Renders sticky/unsticky action links for a post listing item.
 *
 * A stickied post shows an `unsticky` link. An unstickied post shows a `sticky slot 1` link,
 * plus a `sticky slot 2` link when the subreddit already has a sticky (Reddit rejects slot 2
 * otherwise). Stickying into an occupied slot replaces whatever currently holds it.
 */
export function StickyButton ({thing,}: StickyButtonProps,) {
	const isStickied = thing.classList.contains('stickied',)
	const [state, setState,] = useState<StickyState>('idle',)
	const [slot2Available, setSlot2Available,] = useState(false,)
	const fullname = getThingFullname(thing,)
	const subreddit = resolveSubreddit(thing,)

	// Probe whether slot 2 may be offered. Only relevant for unstickied posts.
	useEffect(() => {
		if (isStickied || !subreddit) { return }
		let active = true
		subredditHasSticky(subreddit,).then((has,) => {
			if (active) { setSlot2Available(has,) }
		},).catch((error: unknown,) => log.error(error,))
		return () => {
			active = false
		}
	}, [isStickied, subreddit,],)

	/** Resolves a sticky API call and updates state to 'success' or 'error'. */
	function runAction (promise: Promise<unknown>,) {
		promise.then(() => setState('success',)).catch((err: unknown,) => {
			log.error('Sticky action failed:', err,)
			setState('error',)
		},)
	}

	if (isStickied) {
		if (state === 'success') { return <span className="success">unstickied</span> }
		if (state === 'error') { return <span className="error">failed to unsticky</span> }
		return (
			<a
				style={{cursor: 'pointer',}}
				className="toolbox-sticky-choice"
				onClick={() => {
					if (!fullname) { return }
					runAction(proposeOrUnsticky({subreddit: subreddit ?? '', itemId: fullname, itemKind: 'post',},),)
				}}
			>
				unsticky
			</a>
		)
	}

	if (state === 'success') { return <span className="success">stickied</span> }
	if (state === 'error') { return <span className="error">failed to sticky</span> }

	function doSticky (position: number,) {
		if (!fullname) { return }
		// Stickying occupies a slot, so the subreddit now has a sticky - keep other buttons in sync.
		if (subreddit) { markSubredditHasSticky(subreddit,) }
		runAction(proposeOrSticky({subreddit: subreddit ?? '', itemId: fullname, itemKind: 'post',}, position,),)
	}

	return (
		<span className="toolbox-sticky-choice">
			<a style={{cursor: 'pointer',}} onClick={() => doSticky(1,)}>sticky slot 1</a>
			{slot2Available && (
				<>
					<span>/</span>
					<a style={{cursor: 'pointer',}} onClick={() => doSticky(2,)}>sticky slot 2</a>
				</>
			)}
		</span>
	)
}

/**
 * Creates handlers for the sticky-button feature.
 * @returns An object containing `register`, which contributes sticky buttons to thing flat-list slots.
 *   Call `lifecycle.mount(register())` in `index.ts` to wire cleanup.
 */
export function createStickyButtonHandlers () {
	/** Registers sticky buttons at the thingFlatListActions slot and returns a cleanup function. */
	function register () {
		return renderAtLocation('thingFlatListActions', {id: 'betterbuttons.sticky',}, ({context, target,},) => {
			if (context.kind !== 'post') { return null }
			const thing = target.closest('.thing',)
			if (!thing?.classList.contains('link',)) { return null }
			return <StickyButton thing={thing} />
		},)
	}

	return {register,}
}
