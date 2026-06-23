/** Ambient module declaration for snuownd (typed to the surface Toolbox uses). */
declare module 'snuownd' {
	/** Per-renderer config; whitelist arrays are swapped to scope extra tags to one renderer. */
	interface RendererContext {
		html_element_whitelist: string[]
		html_attr_whitelist: string[]
	}
	/** A Reddit-flavored HTML renderer produced by {@link SnuOwnd.getRedditRenderer}. */
	interface Renderer {
		context: RendererContext
	}
	/** A configured parser that renders Reddit-flavored markdown source to an HTML string. */
	interface Parser {
		render(text: string,): string
	}
	/** The snuownd module: parser/renderer factories plus flag and whitelist constants. */
	interface SnuOwndStatic {
		getParser(renderer?: Renderer,): Parser
		getRedditRenderer(flags?: number,): Renderer
		DEFAULT_BODY_FLAGS: number
		HTML_ALLOW_ELEMENT_WHITELIST: number
		DEFAULT_HTML_ELEMENT_WHITELIST: string[]
		DEFAULT_HTML_ATTR_WHITELIST: string[]
	}
	const SnuOwnd: SnuOwndStatic
	export default SnuOwnd
}
