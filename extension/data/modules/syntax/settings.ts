/** Module settings definitions for the Syntax Highlighter module. */

import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'enableWordWrap',
			sharedPolicy: 'raw',
			description: 'Enable word wrap in editor',
			type: 'boolean',
			default: true,
		},
		{
			id: 'wikiPages',
			sharedPolicy: 'raw',
			description:
				'In addition to the CSS, the following wiki pages get the specified code formatting. Language is one of css, json, markdown, or yaml',
			type: 'map',
			default: {
				'config/automoderator': 'yaml',
				'config/stylesheet': 'css',
				'automoderator-schedule': 'yaml',
				'toolbox': 'json',
			},
			labels: ['page', 'language',], // language is one of [css,json,markdown,yaml] - otherwise, defaults to markdown. md is also explicitly an alias of markdown
		},
		{
			id: 'selectedTheme',
			sharedPolicy: 'raw',
			description: 'Syntax highlight theme selection',
			type: 'syntaxTheme',
			default: 'dracula',
		},
	] as const,
)

/** Inferred settings type for the Syntax Highlighter module. */
export type SyntaxSettings = InferSettings<typeof settings>
