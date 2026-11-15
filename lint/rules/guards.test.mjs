import {RuleTester,} from 'oxlint/plugins-dev'
import {describe, it,} from 'vitest'

import noDirectModerationImports from './no-direct-moderation-imports.mjs'
import noListingEnvelope from './no-listing-envelope.mjs'
import {ROOT,} from './paths.mjs'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester()
const file = (path,) => `${ROOT}/${path}`
const ui = file('extension/data/modules/example/dom.ts',)

describe('toolbox/no-direct-moderation-imports', () => {
	const things = '\'../../api/resources/things\''
	tester.run('no-direct-moderation-imports', noDirectModerationImports, {
		valid: [
			// Unrestricted names, and default imports (these modules have no default export).
			{code: `import {getThing} from ${things}`, filename: ui,},
			{code: `import things from ${things}`, filename: ui,},
			// Restricted names from unrelated modules.
			{code: 'import {removeThing} from \'./localHelpers\'', filename: ui,},
			// The gateway is allowlisted; tests and files outside extension/data are out of scope.
			{
				code: `import {removeThing} from ${things}`,
				filename: file('extension/data/modules/shared/proposals/gateway.ts',),
			},
			{
				code: `import {removeThing} from ${things}`,
				filename: file('extension/data/modules/example/dom.test.ts',),
			},
			{code: `import {removeThing} from ${things}`, filename: file('scripts/tool.ts',),},
		],
		invalid: [
			{code: `import {removeThing, getThing} from ${things}`, filename: ui, errors: 1,},
			// Aliasing and type-only imports still reach the primitive.
			{code: `import {banUser as ban} from '../../api/resources/relationships.ts'`, filename: ui, errors: 1,},
			{code: `import type {flairUser} from '../../api/resources/flair'`, filename: ui, errors: 1,},
			// A namespace import grants access to every restricted name.
			{code: `import * as things from ${things}`, filename: ui, errors: 1,},
			// Re-export barrels would launder the primitive through a non-restricted path.
			{code: `export {approveThing} from ${things}`, filename: ui, errors: 1,},
			{code: `export * from ${things}`, filename: ui, errors: 1,},
			{code: `export * as things from ${things}`, filename: ui, errors: 1,},
			{
				code: `import {applyNativeRemovalReason} from '../../api/resources/removalReasons'`,
				filename: file('extension/data/modules/example/Popup.tsx',),
				errors: 1,
			},
		],
	},)
})

describe('toolbox/no-listing-envelope', () => {
	tester.run('no-listing-envelope', noListingEnvelope, {
		valid: [
			'import {Page} from \'../../api/transport/pagination\'',
			// Tree traversal through `children` is legitimate.
			'const ids = more.data.children',
			// Only the `.data.after` shape is the envelope cursor.
			'const after = page.cursor; const x = data.after; const y = res.data[after]',
			// The API layer owns the envelope.
			{
				code: 'import type {RedditListing} from "../types"; const next = res.data.after',
				filename: file('extension/data/api/resources/example.ts',),
			},
		].map((test,) => typeof test === 'string' ? {code: test, filename: ui,} : test),
		invalid: [
			{code: 'import type {RedditListing} from \'../../api/types\'', filename: ui, errors: 1,},
			{code: 'import {RedditListing as Listing} from \'../../api/types\'', filename: ui, errors: 1,},
			{code: 'const next = response.data.after', filename: ui, errors: 1,},
			{code: 'const prev = response?.data?.before', filename: ui, errors: 1,},
			// Tests outside the API layer are covered too.
			{
				code: 'expect(result.data.after).toBe(null)',
				filename: file('extension/data/modules/x/y.test.ts',),
				errors: 1,
			},
		],
	},)
})
