import {RuleTester,} from 'oxlint/plugins-dev'
import {describe, it,} from 'vitest'

import jsxNoKeyAfterSpread from './jsx-no-key-after-spread.mjs'
import {ROOT,} from './paths.mjs'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester()
const filename = `${ROOT}/extension/data/modules/example/List.tsx`

describe('toolbox/jsx-no-key-after-spread', () => {
	tester.run('jsx-no-key-after-spread', jsxNoKeyAfterSpread, {
		valid: [
			'const a = <Row key={id} {...props} />',
			'const a = <Row {...props} />',
			'const a = <Row key="x" label="y" />',
			// Only `key` matters; other attributes may follow a spread.
			'const a = <Row key={id} {...props} label="y" />',
			// A namespaced attribute that happens to be called `key` is not the React key.
			'const a = <svg {...props} xlink:key="x" />',
		].map((code,) => ({code, filename,})),
		invalid: [
			{code: 'const a = <Row {...props} key={id} />', filename, errors: [{messageId: 'keyAfterSpread',},],},
			{
				code: 'const a = <Row label="y" {...a} {...b} key="x" />',
				filename,
				errors: [{messageId: 'keyAfterSpread',},],
			},
			{code: 'const a = <><Row {...p} key="x"><Cell {...q} key="y" /></Row></>', filename, errors: 2,},
		],
	},)
})
