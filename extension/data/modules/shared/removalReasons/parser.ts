/** Provides a SnuOwnd parser configured to allow the extra HTML elements used in removal reason templates. */

import SnuOwnd from 'snuownd'

/**
 * Returns a SnuOwnd parser that extends the default Reddit renderer with a whitelist
 * of extra HTML elements and attributes needed by removal reason templates
 * (`<select>`, `<option>`, `<textarea>`, `<input>`, `id`, `placeholder`, `label`, `value`).
 */
export function getRemovalReasonParser () {
	const renderer = SnuOwnd.getRedditRenderer(
		SnuOwnd.DEFAULT_BODY_FLAGS | SnuOwnd.HTML_ALLOW_ELEMENT_WHITELIST,
	)
	// Extend the whitelist on this renderer instance only. getRedditRenderer copies the
	// global DEFAULT_HTML_*_WHITELIST arrays by reference into renderer.context, so pushing
	// onto them would leak <select>/<input>/etc. into every other SnuOwnd parser in the
	// app. Replacing context's arrays with extended local copies keeps the extra tags
	// scoped to removal-reason rendering.
	renderer.context.html_element_whitelist = [
		...SnuOwnd.DEFAULT_HTML_ELEMENT_WHITELIST,
		'select',
		'option',
		'textarea',
		'input',
	]
	renderer.context.html_attr_whitelist = [
		...SnuOwnd.DEFAULT_HTML_ATTR_WHITELIST,
		'id',
		'placeholder',
		'label',
		'value',
	]
	return SnuOwnd.getParser(renderer,)
}
