/** Renders the AutoModerator action reason for a queue item, along with a modmail link for a second opinion. */

interface Props {
	/** The action reason string from the mod log entry. */
	actionReasonText: string
	/** Subreddit name, used to pre-fill the modmail compose URL. */
	subreddit: string
	/** Permalink of the filtered item, included in the modmail template. */
	permalink: string
}

/**
 * Renders the AutoModerator action reason for a queue item, along with a modmail link for a second opinion.
 */
export function AutomodActionReason ({actionReasonText, subreddit, permalink,}: Props,) {
	const composeParams = new URLSearchParams({
		to: `/r/${subreddit}`,
		subject: 'Automoderator second opinion',
		message:
			`I would like a second opinion about something automod filtered\n\nUrl: ${permalink}\n\nAction reason: ${actionReasonText}`,
	},)

	return (
		<div className="action-reason">
			<b>Automod action:</b>
			{` ${actionReasonText}`}
			<br />
			<a
				href={`https://www.reddit.com/message/compose?${composeParams}`}
				target="_blank"
				rel="noreferrer"
			>
				ask for a second opinion in modmail
			</a>
		</div>
	)
}
