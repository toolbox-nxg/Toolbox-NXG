/** Text highlighting utilities that wrap matched substrings in styled `<span>` elements. */

import './highlight.css'

/**
 * Highlights occurrences of `pat` inside `element` by wrapping matched text nodes
 * in `<span class="toolbox-highlight">` (or `toolbox-highlight-action-reason` when
 * `actionReason` is true). Skips `<script>` / `<style>` subtrees and anything
 * inside `.usertext-edit`.
 * @param element The root element whose text nodes are searched.
 * @param pat String, array of strings, or RegExp to match.
 * @param ignore When true, performs accent/diacritic-insensitive matching.
 * @param actionReason When true, uses the action-reason highlight class instead of the default.
 */
export function highlight (
	element: Element,
	pat: string | string[] | RegExp,
	ignore = false,
	actionReason = false,
): void {
	if (!pat || (Array.isArray(pat,) && pat.length === 0)) {
		return
	}
	if (element.parentElement?.classList.contains('usertext-edit',)) {
		return
	}
	if (pat instanceof RegExp) {
		walkHighlightRegex(element, pat, actionReason,)
	} else {
		walkHighlight(element, Array.isArray(pat,) ? pat : [pat,], ignore, actionReason,)
	}
}

/** Removes all highlight spans previously added by {@link highlight}. */
export function removeHighlight (element: Element,): void {
	element.querySelectorAll('span.toolbox-highlight, span.toolbox-highlight-action-reason',).forEach((span,) => {
		const parent = span.parentNode
		if (!parent) {
			return
		}
		const child = span.firstChild
		if (child) {
			parent.replaceChild(child, span,)
		}
		parent.normalize()
	},)
}

// --- internals ---------------------------------------------------------------

function replaceDiacritics (str: string,): string {
	const map: [RegExp, string,][] = [
		[/[À-Æ]/g, 'A',],
		[/[à-æ]/g, 'a',],
		[/[Ç]/g, 'C',],
		[/[ç]/g, 'c',],
		[/[È-Ë]/g, 'E',],
		[/[è-ë]/g, 'e',],
		[/[Ì-Ï]/g, 'I',],
		[/[ì-ï]/g, 'i',],
		[/[ÑŇ]/g, 'N',],
		[/[ñň]/g, 'n',],
		[/[Ò-ØŐ]/g, 'O',],
		[/[ò-øő]/g, 'o',],
		[/[Š]/g, 'S',],
		[/[š]/g, 's',],
		[/[Ù-Ü]/g, 'U',],
		[/[ù-ü]/g, 'u',],
		[/[Ý]/g, 'Y',],
		[/[ý]/g, 'y',],
	]
	for (const [re, ch,] of map) {
		str = str.replace(re, ch,)
	}
	return str
}

/**
 * Walks a DOM subtree, calling `matchText` on each text node. Skips script/style subtrees.
 * Returns 1 when the text node was split (so the caller's loop can skip the inserted span), 0 otherwise.
 */
function walkNodes (node: Node, matchText: (text: Text,) => number,): number {
	if (node.nodeType === Node.TEXT_NODE) {
		return matchText(node as Text,)
	}
	if (
		node.nodeType === Node.ELEMENT_NODE
		&& (node as Element).childNodes.length > 0
		&& !/(script|style)/i.test((node as Element).tagName,)
	) {
		const children = node.childNodes
		for (let i = 0; i < children.length; i++) {
			i += walkNodes(children[i]!, matchText,)
		}
	}
	return 0
}

function walkHighlightRegex (node: Node, pattern: RegExp, actionReason: boolean,): number {
	return walkNodes(node, (text,) => {
		pattern.lastIndex = 0
		const match = pattern.exec(text.data,)
		if (match && match[0].length > 0) {
			const span = document.createElement('span',)
			span.className = actionReason ? 'toolbox-highlight-action-reason' : 'toolbox-highlight'
			const middle = text.splitText(match.index,)
			middle.splitText(match[0].length,)
			span.appendChild(middle.cloneNode(true,),)
			middle.parentNode!.replaceChild(span, middle,)
			return 1
		}
		return 0
	},)
}

function walkHighlight (node: Node, patterns: string[], ignore: boolean, actionReason: boolean,): number {
	return walkNodes(node, (text,) => {
		for (const raw of patterns) {
			if (raw === '') {
				continue
			}
			const term = (ignore ? replaceDiacritics(raw,) : raw).toUpperCase()
			const data = (ignore ? replaceDiacritics(text.data,) : text.data).toUpperCase()
			const pos = data.indexOf(term,)
			if (pos >= 0) {
				const span = document.createElement('span',)
				span.className = actionReason ? 'toolbox-highlight-action-reason' : 'toolbox-highlight'
				const middle = text.splitText(pos,)
				middle.splitText(term.length,)
				span.appendChild(middle.cloneNode(true,),)
				middle.parentNode!.replaceChild(span, middle,)
				return 1
			}
		}
		return 0
	},)
}
