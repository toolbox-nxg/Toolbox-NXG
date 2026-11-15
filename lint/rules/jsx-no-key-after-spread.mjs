/**
 * `toolbox/jsx-no-key-after-spread` — `key` must come before any `{...spread}` in a JSX element.
 *
 * With the automatic JSX runtime (`"jsx": "react-jsx"`), `<Row {...props} key={id} />` can't
 * compile to `jsx()`: a spread could itself carry a `key`, and which one wins depends on order, so
 * the compiler falls back to the legacy `createElement()` path for that element. Writing `key`
 * first (`<Row key={id} {...props} />`) keeps the fast path and makes the element's identity
 * unambiguous. Ported from `@eslint-react/jsx-no-key-after-spread`, which oxlint lacks.
 */

/** @type {import('oxlint/plugins-dev').Rule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require `key` to come before any spread attribute in a JSX element.',
		},
		messages: {
			keyAfterSpread: '`key` comes after a spread attribute; move it before `{...}` so the element compiles '
				+ 'to `jsx()` and its key is unambiguous.',
		},
		schema: [],
	},
	create (context,) {
		return {
			JSXOpeningElement (node,) {
				let sawSpread = false
				for (const attribute of node.attributes) {
					if (attribute.type === 'JSXSpreadAttribute') {
						sawSpread = true
					} else if (sawSpread && attribute.name.type === 'JSXIdentifier' && attribute.name.name === 'key') {
						context.report({node: attribute, messageId: 'keyAfterSpread',},)
					}
				}
			},
		}
	},
}
