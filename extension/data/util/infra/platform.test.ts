/** Tests for old-Reddit -> shreddit moderation-path remapping. */

import {describe, expect, it,} from 'vitest'

import {remapModPath,} from './platform'

describe('remapModPath', () => {
	// Regression (r/toolbox_nxg): the unmoderated queue link relied on Reddit's own
	// old->new redirect, which appends a stray trailing slash (`?queueType=unmoderated/`)
	// and lands on Needs Review. Remapping to the native shreddit URL avoids it.
	it('never emits a trailing slash on the queueType value', () => {
		expect(remapModPath('/r/mod/about/unmoderated',),).not.toContain('unmoderated/',)
	})

	// Aggregate /r/mod/ queues -> /mod/queue with a queueType param.
	it('maps every aggregate /r/mod/ queue', () => {
		expect(remapModPath('/r/mod/about/modqueue',),).toBe('/mod/queue?queueType=mod',)
		expect(remapModPath('/r/mod/about/unmoderated',),).toBe('/mod/queue?queueType=unmoderated',)
		expect(remapModPath('/r/mod/about/edited',),).toBe('/mod/queue?queueType=edited',)
		expect(remapModPath('/r/mod/about/spam',),).toBe('/mod/queue?queueType=removed',)
		expect(remapModPath('/r/mod/about/reports',),).toBe('/mod/queue',)
	})

	// Per-subreddit queues -> /mod/<sub>/queue, with a queueType param except the
	// default (reports) queue.
	it('maps every per-subreddit queue', () => {
		expect(remapModPath('/r/somesub/about/reports',),).toBe('/mod/somesub/queue',)
		expect(remapModPath('/r/somesub/about/modqueue',),).toBe('/mod/somesub/queue?queueType=mod',)
		expect(remapModPath('/r/somesub/about/unmoderated',),).toBe('/mod/somesub/queue?queueType=unmoderated',)
		expect(remapModPath('/r/somesub/about/edited',),).toBe('/mod/somesub/queue?queueType=edited',)
		expect(remapModPath('/r/somesub/about/spam',),).toBe('/mod/somesub/queue?queueType=removed',)
	})

	// Per-subreddit non-queue mod pages map to their own shreddit paths.
	it('maps per-subreddit non-queue mod pages', () => {
		expect(remapModPath('/r/somesub/about/log',),).toBe('/mod/somesub/log',)
		expect(remapModPath('/r/somesub/about/traffic',),).toBe('/mod/somesub/insights',)
		expect(remapModPath('/r/somesub/about/flair',),).toBe('/mod/somesub/userflair',)
		expect(remapModPath('/r/somesub/about/muted',),).toBe('/mod/somesub/muted',)
		expect(remapModPath('/r/somesub/about/banned',),).toBe('/mod/somesub/banned',)
	})

	// Paths with no mapping return null so callers pass them through unchanged. This
	// covers the /about/ pages Toolbox links to that have no shreddit remap, plus
	// non-moderation paths.
	it('returns null for mod /about/ pages with no shreddit mapping', () => {
		expect(remapModPath('/r/somesub/about/moderators',),).toBeNull()
		expect(remapModPath('/r/somesub/about/rules',),).toBeNull()
		expect(remapModPath('/r/somesub/about/sidebar',),).toBeNull()
		expect(remapModPath('/r/somesub/about/usernotes',),).toBeNull()
	})

	it('returns null for non-moderation paths', () => {
		expect(remapModPath('/user/someone',),).toBeNull()
		expect(remapModPath('/r/somesub/wiki/index',),).toBeNull()
		expect(remapModPath('/r/somesub',),).toBeNull()
		expect(remapModPath('/comments/abc123',),).toBeNull()
	})
})
