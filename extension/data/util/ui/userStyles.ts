/** Holds the moderator's custom CSS and keeps every copy of it (page head and each Toolbox shadow root) in sync. */

let userCss = ''

// Shared constructable sheet for shadow roots that use adoptedStyleSheets: a single
// replaceSync() restyles every one of them at once. Created lazily because it is only
// needed on the adopted-sheet path, and null where constructable sheets are unavailable.
let userSheet: CSSStyleSheet | null | undefined

// <style> copies for shadow roots on the <link> fallback path (Firefox content scripts
// cannot adopt sandbox-constructed sheets). Held weakly so discarded roots can be collected.
const fallbackStyles = new Set<WeakRef<HTMLStyleElement>>()

// The light-DOM copy that reaches Reddit's page and Toolbox's light-DOM mounts (the modbar).
let documentStyle: HTMLStyleElement | null = null

/**
 * Returns the shared sheet holding the custom CSS, for adoption alongside the bundled sheet.
 * Adopt it after the bundled sheet: later adopted sheets win ties, so the user's rules
 * override Toolbox's at equal specificity.
 * @returns The sheet, or `null` when constructable stylesheets are unsupported.
 */
export function getUserStyleSheet (): CSSStyleSheet | null {
	if (userSheet === undefined) {
		try {
			const sheet = new CSSStyleSheet()
			sheet.replaceSync(userCss,)
			userSheet = sheet
		} catch {
			userSheet = null
		}
	}
	return userSheet
}

/**
 * Appends a `<style>` copy of the custom CSS to a shadow root and keeps it updated.
 * Call this after the root's bundled stylesheet `<link>`, so tree order lets the
 * user's rules override Toolbox's at equal specificity.
 */
export function appendUserStyleElement (shadowRoot: ShadowRoot,): void {
	const style = document.createElement('style',)
	style.dataset.toolboxUserCss = ''
	style.textContent = userCss
	shadowRoot.appendChild(style,)
	fallbackStyles.add(new WeakRef(style,),)
}

/**
 * Returns the custom CSS `<style>` in the page head, if any. Stylesheets added to the head
 * later should be inserted before it, so the user's rules keep winning ties.
 */
export function getDocumentUserStyleElement (): HTMLStyleElement | null {
	return documentStyle
}

/**
 * Replaces the custom CSS everywhere it is applied: the page head, the shared adopted
 * sheet, and every fallback `<style>` copy. An empty string removes the head copy.
 */
export function setUserCss (css: string,): void {
	userCss = css

	if (userSheet) { userSheet.replaceSync(css,) }

	for (const ref of fallbackStyles) {
		const style = ref.deref()
		if (style) {
			style.textContent = css
		} else {
			fallbackStyles.delete(ref,)
		}
	}

	if (!css) {
		documentStyle?.remove()
		documentStyle = null
		return
	}
	if (!documentStyle) {
		documentStyle = document.createElement('style',)
		documentStyle.dataset.toolboxUserCss = ''
	}
	documentStyle.textContent = css
	// Appended once, after the stylesheets already in the head; Toolbox's own later head
	// stylesheets are inserted before it (see getDocumentUserStyleElement).
	if (!documentStyle.isConnected) { document.head.appendChild(documentStyle,) }
}
