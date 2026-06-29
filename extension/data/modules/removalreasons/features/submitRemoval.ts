/**
 * The removal submission pipeline: removes the thing, then handles flair, log
 * post, reply/Modmail delivery, usernote, and ban according to the chosen
 * options. Pure async logic - all UI feedback flows back through the returned
 * result and the `onWarning` callback.
 *
 * The usernote write path and outgoing message bodies are wire-format
 * sensitive; their construction must not change shape.
 */

import {postComment,} from '../../../api/resources/comments'
import {flairPost,} from '../../../api/resources/flair'
import {archiveModmail, sendModmail,} from '../../../api/resources/modmail'
import {banUser,} from '../../../api/resources/relationships'
import {postLink,} from '../../../api/resources/submissions'
import {
	approveThing,
	distinguishThing,
	lock,
	removeThing,
	sendOfficialRemovalMessage,
} from '../../../api/resources/things'
import {removalReasons,} from '../../../framework/moduleIds'
import {removeQuotes,} from '../../../util/data/string'
import createLogger from '../../../util/infra/logging'
import type {RemovalTarget,} from '../../../util/wiki/schemas/proposals/schema'
import {UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {rememberMessageLink,} from '../../shared/usernotes/messageLinkCache'
import {updateUserNotes,} from '../../shared/usernotes/moduleapi'
import {applyUserNoteMutation, makeUserNoteEntry,} from '../../shared/usernotes/noteMutations'
import {publishSubredditNotes,} from '../../shared/usernotes/store'
import {
	banError,
	distinguishError,
	flairError,
	lockCommentError,
	lockPostError,
	logPostError,
	logReasonMissingError,
	modmailArchiveError,
	modmailError,
	noReasonError,
	noReplyTypeError,
	type ReasonType,
	removeError,
	replyError,
	replyErrorSubreddit,
	usernoteError,
} from '../components/RemovalReasonsOverlay.helpers'

const log = createLogger(removalReasons,)

/** Everything the submission pipeline needs, captured from the overlay's form state. */
export interface SubmitRemovalParams {
	/**
	 * The removed thing's metadata. Narrowed to {@link RemovalTarget} (the 9 fields
	 * the pipeline actually reads) so the params double as the serializable frozen
	 * intent for a removal-reason proposal. The overlay passes the full
	 * `RemovalReasonsData`, which is structurally assignable.
	 */
	data: RemovalTarget
	/** Final composed reason text, with header/footer and tokens already applied. */
	reasonText: string
	/**
	 * Display title(s) of the selected reason template(s), joined with ", ". Carried only
	 * so {@link freezeRemovalParams} can record it on a proposal for review; the removal
	 * pipeline itself does not read it.
	 */
	reasonTitle?: string
	/** Trimmed flair text accumulated from the selected reasons; empty = no flair. */
	flairText: string
	/** Trimmed flair CSS class accumulated from the selected reasons; empty = no flair. */
	flairCSS: string
	flairTemplateID: string
	/** Token-substituted Modmail subject line. */
	subject: string
	/** Token-substituted log post title (before `{reason}` substitution). */
	baseLogTitle: string
	/** User-entered public log reason, substituted into `{reason}` in the log title. */
	logReasonText: string
	reasonType: ReasonType
	reasonSticky: boolean
	reasonAsSub: boolean
	reasonAutoArchive: boolean
	reasonCommentAsSubreddit: boolean
	actionLockThread: boolean
	actionLockComment: boolean
	/** Remove as spam (trains the spam filter) rather than a plain removal. */
	spam?: boolean
	leaveUsernote: boolean
	usernoteText: string
	usernoteType: string | undefined
	usernoteIncludeLink: boolean
	/** Store the removal modmail conversation link on the usernote. */
	usernoteIncludeMessage: boolean
	subredditColors: UserNoteColor[] | null
	issueBan: boolean
	banPermanent: boolean
	banDays: number
	banNote: string
}

/** Outcome of the submission pipeline. */
export type SubmitRemovalResult =
	| {ok: true}
	| {
		ok: false
		error: string
		/** Form area to highlight for this error, when one applies. */
		errorField?: 'buttons' | 'logReasonInput'
	}

/**
 * Runs the full removal pipeline for the composed reason.
 * @param params Form state captured at submit time.
 * @param onWarning Reports a non-fatal problem (e.g. flair or distinguish
 *   failure) that should be surfaced without aborting the removal.
 */
export async function submitRemoval (
	params: SubmitRemovalParams,
	onWarning: (message: string,) => void,
): Promise<SubmitRemovalResult> {
	const {
		data,
		reasonText,
		flairText: ft,
		flairCSS: fc,
		flairTemplateID,
		subject,
		baseLogTitle,
		logReasonText,
		reasonType,
		reasonSticky,
		reasonAsSub,
		reasonAutoArchive,
		reasonCommentAsSubreddit,
		actionLockThread,
		actionLockComment,
		leaveUsernote,
		usernoteText,
		usernoteType,
		usernoteIncludeLink,
		usernoteIncludeMessage,
		subredditColors,
		issueBan,
		banPermanent,
		banDays,
		banNote,
	} = params

	try {
		await removeThing(data.fullname, params.spam ?? false,)
	} catch {
		return {ok: false, error: removeError,}
	}

	/**
	 * Full URL of the modmail conversation carrying the removal reason, set
	 * once the modmail delivery succeeds. The usernote write in `runExtras`
	 * runs after delivery settles, so this is populated in time to be stored
	 * on the note as its `messageLink`.
	 */
	let removalMessageLink = ''

	// Flair if needed
	if ((ft !== '' || fc !== '') && data.kind !== 'comment') {
		flairPost({
			postLink: data.fullname,
			subreddit: data.subreddit,
			text: ft,
			cssClass: fc,
			templateID: flairTemplateID,
		},).catch(() => {
			onWarning(flairError,)
		},)
	}

	/** Post-delivery extras: usernote write and ban, both fatal on failure. */
	const runExtras = async () => {
		if (!data.author) { return }

		// Bans suppress the regular removal modmail (the ban message carries the
		// reason), and reasons too long for the native ban message are delivered
		// through a dedicated modmail conversation instead. Send that modmail
		// *before* the usernote write below so the note can carry its link -
		// it's the only removal message that exists when banning.
		let banMsg = reasonText
		if (issueBan && reasonText.length > 999) {
			let conversationUrl = ''
			try {
				const mailBody = `${reasonText}\n\n---\n[[Link to removed ${data.kind}](${data.url})]`
				const res = await sendModmail({
					subreddit: data.subreddit,
					to: data.author,
					subject,
					body: mailBody,
					isAuthorHidden: true,
				},)
				conversationUrl = `https://www.reddit.com/message/messages/${res.conversation.id}`
				removalMessageLink = `https://www.reddit.com/mail/perma/${res.conversation.id}`
				// Let notes added later this page session link to this conversation.
				rememberMessageLink([data.url,], removalMessageLink,)
			} catch {
				// Modmail send failed - fall back to generic text with no link.
			}
			banMsg = conversationUrl
				? `See [here](${conversationUrl}) for more information about this ban.`
				: 'See your modmail inbox for more information about this ban.'
		}

		if (leaveUsernote && usernoteText.trim()) {
			try {
				const newNote = makeUserNoteEntry({
					note: usernoteText,
					mod: data.mod,
					// Link the removed thing's own permalink (`url`). `link` is the
					// submission link: empty for comments and the external URL for
					// link posts, so neither matches "link to removed item".
					...(usernoteIncludeLink && data.url ? {link: data.url,} : {}),
					...(usernoteType !== undefined ? {type: usernoteType,} : {}),
					...(usernoteIncludeMessage && removalMessageLink ? {messageLink: removalMessageLink,} : {}),
				},)
				// Merge the new note into the live dataset inside the save queue so
				// a note added concurrently by another mod isn't clobbered.
				const merged = await updateUserNotes(
					data.subreddit,
					(fresh,) => applyUserNoteMutation(fresh, data.author, {change: 'add', note: newNote,},),
				)
				if (merged) {
					publishSubredditNotes(data.subreddit, {notes: merged, colors: subredditColors ?? [],},)
				}
			} catch {
				throw new Error(usernoteError,)
			}
		}

		if (issueBan) {
			try {
				await banUser({
					user: data.author,
					subreddit: data.subreddit,
					note: banNote.slice(0, 300,),
					banMessage: banMsg,
					banDuration: banPermanent ? 0 : banDays,
					banContext: data.link,
				},)
			} catch {
				throw new Error(banError,)
			}
		}
	}

	const sendNativeRemovalMessage = async (logLink: string | null,): Promise<SubmitRemovalResult> => {
		if (reasonText.trim().length < 1) {
			if ((ft !== '' || fc !== '') && data.kind !== 'comment') {
				return {ok: true,}
			}
			return {ok: false, error: noReasonError,}
		}

		if (logLink == null && reasonType === 'none') {
			return {ok: false, error: noReplyTypeError, errorField: 'buttons',}
		}

		const msg = logLink !== null ? reasonText.replace('{loglink}', logLink,) : reasonText

		if (actionLockThread) {
			try {
				await lock(data.fullname,)
			} catch (err) {
				log.error(`error locking ${data.fullname}:`, err,)
				return {ok: false, error: lockPostError,}
			}
		}

		const notifyByModmail = !issueBan && (reasonType === 'pm' || reasonType === 'both')
		const notifyByReply = reasonType === 'reply' || reasonType === 'both'

		const sendReplyAsSubreddit = async () => {
			try {
				await sendOfficialRemovalMessage({
					fullname: data.fullname,
					message: msg,
					lockComment: actionLockComment,
				},)
			} catch {
				throw new Error(replyErrorSubreddit,)
			}
		}

		const sendReplyAsSelf = async () => {
			let comment
			try {
				comment = await postComment(data.fullname, msg,)
			} catch {
				throw new Error(replyError,)
			}
			try {
				await distinguishThing(comment.fullname, reasonSticky,)
			} catch {
				onWarning(distinguishError,)
			}
			if (actionLockComment) {
				try {
					await lock(comment.fullname,)
				} catch {
					throw new Error(lockCommentError,)
				}
			}
		}

		const sendModmailMessage = async () => {
			const body = `${msg}\n\n---\n[[Link to your ${data.kind}](${data.url})]`
			let res: Awaited<ReturnType<typeof sendModmail>>
			try {
				res = await sendModmail({
					subreddit: data.subreddit,
					to: data.author,
					subject,
					body,
					// Hide the sending mod's identity only when the reason is sent "as
					// the subreddit"; otherwise it goes out as the individual mod.
					isAuthorHidden: reasonAsSub,
				},)
			} catch {
				throw new Error(modmailError,)
			}
			const id = res.conversation.id
			// Record the conversation so the usernote written below (and any
			// note added later this page session) can carry the message link.
			// Keyed by the thing's own permalink only: `data.link` is the
			// submission's *target* URL, which for link posts points at an
			// arbitrary page - possibly an unrelated reddit thread - and would
			// poison the cache for notes added on that thread.
			removalMessageLink = `https://www.reddit.com/mail/perma/${id}`
			rememberMessageLink([data.url,], removalMessageLink,)
			const isInternal = res.conversation.isInternal
			if (reasonAutoArchive && !isInternal) {
				try {
					await archiveModmail(id,)
				} catch {
					throw new Error(modmailArchiveError,)
				}
			}
		}

		const results = await Promise.allSettled([
			notifyByReply
				? (reasonCommentAsSubreddit ? sendReplyAsSubreddit() : sendReplyAsSelf())
				: Promise.resolve(),
			notifyByModmail ? sendModmailMessage() : Promise.resolve(),
		],)
		const errs = results.filter((r,) => r.status === 'rejected')
		if (errs.length) {
			return {
				ok: false,
				error: `error${errs.length > 1 ? 's' : ''}: ${
					errs.map((r,) => (r.reason instanceof Error ? r.reason.message : String(r.reason,))).join('; ',)
				}`,
			}
		}
		try {
			await runExtras()
			return {ok: true,}
		} catch (err) {
			return {ok: false, error: err instanceof Error ? err.message : String(err,),}
		}
	}

	if (data.logSub) {
		let logTitleMut = baseLogTitle
		if (logTitleMut.indexOf('{reason}',) >= 0) {
			if (!logReasonText) {
				return {ok: false, error: logReasonMissingError, errorField: 'logReasonInput',}
			}
			logTitleMut = logTitleMut.replace('{reason}', logReasonText,)
		}
		let post
		try {
			post = await postLink(
				data.logSub,
				data.url || data.link,
				removeQuotes(logTitleMut,),
			)
		} catch {
			return {ok: false, error: logPostError,}
		}
		// Best-effort: approve the freshly-posted log entry so it doesn't sit in the
		// modqueue. A failure here must not abort the removal, so log and continue.
		try {
			await approveThing(post.name,)
		} catch (err) {
			log.error('Failed to approve removal log post:', err,)
		}
		if (reasonType === 'none') {
			try {
				await runExtras()
				return {ok: true,}
			} catch (err) {
				return {ok: false, error: err instanceof Error ? err.message : String(err,),}
			}
		}
		return sendNativeRemovalMessage(post.url,)
	}
	return sendNativeRemovalMessage(null,)
}
