/** Setting definitions and inferred settings type for the Comment Triage module. */
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'highlightAuto',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Highlight comments automatically',
		},
		{
			id: 'negHighlightThreshold',
			sharedPolicy: 'raw',
			type: 'number',
			default: 0,
			description: 'Negative comment highlight score threshold',
		},
		{
			id: 'highlightControversy',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Highlight controversial comments',
		},
		{
			id: 'expandOnLoad',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Expand all downvoted/controversial comments on page load',
		},
		{
			id: 'sortOnMoreChildren',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			description: 'Continue to sort children on "load more comments"',
		},
		{
			id: 'displayNChildren',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: true,
			description: 'Always display the number of children a comment has.',
		},
		{
			id: 'displayNChildrenTop',
			sharedPolicy: 'raw',
			type: 'boolean',
			default: false,
			advanced: true,
			description:
				'Display the number of children a comment has in the upper left.  This may change the normal flow of the comments page slightly.',
		},
	] as const,
)

/** Inferred settings type for the Comment Triage module. */
export type CommentTriageSettings = InferSettings<typeof settings>
