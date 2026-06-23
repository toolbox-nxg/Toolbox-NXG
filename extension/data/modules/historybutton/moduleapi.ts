/** API helpers for fetching and aggregating a user's submission and comment history data. */
import type {CommentData, RedditThing, SubmissionData,} from '../../api/resources/things'
import {aboutUser,} from '../../api/resources/users'
import {getUserComments, getUserSubmissions,} from '../../api/resources/users'
import {CommentHistoryData, SubmissionHistoryData, UserInfo,} from './schema'

/**
 * Fetches basic account information for a Reddit user.
 * @returns Account age, submission karma, and comment karma.
 */
export async function getUserInfo (user: string,): Promise<UserInfo> {
	const {data,} = await aboutUser(user,)
	return {
		createdAt: new Date(data.created_utc * 1000,),
		submissionKarma: data.link_karma,
		commentKarma: data.comment_karma,
	}
}

// Matches http(s) URLs; excludes trailing punctuation that isn't part of the URL.
const urlRegex = /https?:\/\/[^\s"()[\]<>]+/g

function extractExternalLinkDomains (text: string,): string[] {
	const matches = text.match(urlRegex,) ?? []
	const result: string[] = []
	for (const raw of matches) {
		try {
			const {hostname,} = new URL(raw,)
			if (hostname && hostname !== 'reddit.com' && !hostname.endsWith('.reddit.com',)) {
				result.push(hostname,)
			}
		} catch {
			// malformed URL, skip
		}
	}
	return result
}

function incrementDomain (map: Record<string, {count: number}>, domain: string,) {
	const entry = map[domain] ??= {count: 0,}
	entry.count++
}

/** Extracts external link domains from `text` and increments each in `map`. No-ops if `text` is falsy. */
function accumulateLinkDomains (map: Record<string, {count: number}>, text: string | null | undefined,) {
	if (!text) { return }
	for (const domain of extractExternalLinkDomains(text,)) {
		incrementDomain(map, domain,)
	}
}

/**
 * Fetches and aggregates a user's submission history into domain and subreddit frequency tables.
 * @returns Total submission count, per-domain counts, per-subreddit counts with karma, and external domains linked in selfpost bodies.
 */
export async function getSubmissionHistoryData (user: string,): Promise<SubmissionHistoryData> {
	let total = 0
	const domains = Object.create(null,) as Record<string, {count: number}>
	const subreddits = Object.create(null,) as Record<string, {count: number; karma: number}>
	const textLinkDomains = Object.create(null,) as Record<string, {count: number}>

	const children = await getUserSubmissions(user,) as RedditThing<SubmissionData & {selftext?: string}>[]
	total = children.length

	children.forEach((value,) => {
		const submission = value.data

		const domainEntry = domains[submission.domain ?? ''] ??= {count: 0,}
		domainEntry.count += 1

		const subredditEntry = subreddits[submission.subreddit] ??= {count: 0, karma: 0,}
		subredditEntry.count += 1
		subredditEntry.karma += submission.score ?? 0

		if (submission.is_self) {
			accumulateLinkDomains(textLinkDomains, submission.selftext,)
		}
	},)

	return {total, domains, subreddits, textLinkDomains,}
}

/**
 * Fetches and aggregates a user's comment history into subreddit and external link domain frequency tables.
 * @param user The user whose comment history to fetch.
 * @param commentCount Maximum number of comments to retrieve.
 * @returns Total comment count, per-subreddit counts, and external domains linked in comment bodies.
 */
export async function getCommentHistoryData (user: string, commentCount: number,): Promise<CommentHistoryData> {
	const subreddits = Object.create(null,) as Record<string, number>
	const linkDomains = Object.create(null,) as Record<string, {count: number}>

	const children = await getUserComments(user, commentCount,) as RedditThing<CommentData & {body?: string}>[]
	const total = children.length

	children.forEach((comment,) => {
		const {subreddit, body,} = comment.data
		subreddits[subreddit] ??= 0
		subreddits[subreddit] += 1
		accumulateLinkDomains(linkDomains, body,)
	},)

	return {total, subreddits, linkDomains,}
}
