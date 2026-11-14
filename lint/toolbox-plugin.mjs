/**
 * Toolbox's own lint rules, loaded by oxlint as a JS plugin (`jsPlugins` in `.oxlintrc.json`).
 * Each rule scopes itself by file path, so it behaves the same whatever the config's overrides.
 *
 * - `toolbox/no-direct-moderation-imports` — mutating moderation primitives go through the
 *   proposals gateway (see docs/developer/module-architecture.md).
 * - `toolbox/no-listing-envelope` — the REST listing envelope stays inside `extension/data/api/`.
 * - `toolbox/param-conventions` — canonical parameter order/naming and matching `@param` tags
 *   (convention in `lint/param-conventions.mjs`; see docs/developer/param-conventions.md).
 */

import noDirectModerationImports from './rules/no-direct-moderation-imports.mjs'
import noListingEnvelope from './rules/no-listing-envelope.mjs'
import paramConventions from './rules/param-conventions.mjs'

export default {
	meta: {name: 'toolbox',},
	rules: {
		'no-direct-moderation-imports': noDirectModerationImports,
		'no-listing-envelope': noListingEnvelope,
		'param-conventions': paramConventions,
	},
}
