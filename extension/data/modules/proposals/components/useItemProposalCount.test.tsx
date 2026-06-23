/** Tests for the shared per-subreddit open-proposal-count store behind the inline badges. */

import {act, createElement, Fragment,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// Pulled in transitively via the proposals event bus' cross-tab broadcast.
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn().mockResolvedValue(undefined,),},},}),)

const loadProposals = vi.hoisted(() => vi.fn())
vi.mock('../../shared/proposals/moduleapi', () => ({loadProposals,}),)

const isModSub = vi.hoisted(() => vi.fn())
vi.mock('../../../api/resources/modSubs', () => ({isModSub,}),)

import type {Proposal, ProposalsData,} from '../../../util/wiki/schemas/proposals/schema'
import {emitProposalsChanged,} from '../../shared/proposals/events'
import {useItemProposalCount,} from './useItemProposalCount'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/** Builds a minimal pending proposal targeting `itemId`. */
function proposal (id: string, itemId: string,): Proposal {
	return {
		id,
		itemId,
		itemKind: 'post',
		action: {type: 'remove', spam: false,},
		proposedBy: 'trainee',
		proposedAt: 1,
		updatedAt: 1,
		source: 'training',
		status: 'pending',
	}
}

/** Wraps proposals into a ProposalsData page. */
function page (...proposals: Proposal[]): ProposalsData {
	return {ver: 1, proposals: Object.fromEntries(proposals.map((p,) => [p.id, p,]),),}
}

/** Probe component that renders its hook's count into a queryable span. */
function Probe ({subreddit, itemId,}: {subreddit: string; itemId: string},) {
	const count = useItemProposalCount(subreddit, itemId,)
	return createElement('span', {'data-item': itemId,}, count,)
}

const roots: Root[] = []

function countFor (host: HTMLElement, itemId: string,): number {
	return Number(host.querySelector(`[data-item="${itemId}"]`,)?.textContent,)
}

beforeEach(() => {
	vi.clearAllMocks()
	// Default: the viewer moderates the sub, so counts load. The non-mod case overrides this.
	isModSub.mockResolvedValue(true,)
},)

afterEach(() => {
	roots.forEach((root,) => act(() => root.unmount()))
	roots.length = 0
	document.body.innerHTML = ''
},)

describe('useItemProposalCount', () => {
	it('shares one load across badges for the same sub and updates them on change', async () => {
		loadProposals.mockResolvedValue(
			page(proposal('p1', 't3_a',), proposal('p2', 't3_a',), proposal('p3', 't3_b',),),
		)
		const host = document.createElement('div',)
		document.body.appendChild(host,)
		const root = createRoot(host,)
		roots.push(root,)

		await act(async () => {
			root.render(
				createElement(Fragment, null, [
					createElement(Probe, {key: 'a', subreddit: 'sub', itemId: 't3_a',},),
					createElement(Probe, {key: 'b', subreddit: 'sub', itemId: 't3_b',},),
				],),
			)
		},)
		await act(async () => {},) // flush the initial async load

		expect(countFor(host, 't3_a',),).toBe(2,)
		expect(countFor(host, 't3_b',),).toBe(1,)
		// One shared load + subscription for both badges, not one each.
		expect(loadProposals,).toHaveBeenCalledTimes(1,)

		// A change recomputes once and fans out to every badge.
		loadProposals.mockResolvedValue(page(proposal('p1', 't3_a',),),)
		await act(async () => {
			emitProposalsChanged('sub',)
		},)
		await act(async () => {},)

		expect(countFor(host, 't3_a',),).toBe(1,)
		expect(countFor(host, 't3_b',),).toBe(0,)
		expect(loadProposals,).toHaveBeenCalledTimes(2,) // one recompute, not one per badge
	})

	it('never reads the mod-only proposals page for a sub the viewer does not moderate', async () => {
		// On a user page the items in view belong to arbitrary subs; proposals are mod-only, so
		// a non-mod sub must not probe its toolbox-nxg/proposals page.
		isModSub.mockResolvedValue(false,)
		const host = document.createElement('div',)
		document.body.appendChild(host,)
		const root = createRoot(host,)
		roots.push(root,)

		await act(async () => {
			root.render(createElement(Probe, {subreddit: 'notmine', itemId: 't3_a',},),)
		},)
		await act(async () => {},) // flush the async mod check

		expect(countFor(host, 't3_a',),).toBe(0,)
		expect(loadProposals,).not.toHaveBeenCalled()
	})
})
