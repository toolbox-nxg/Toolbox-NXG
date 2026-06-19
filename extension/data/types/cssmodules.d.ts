/** Ambient type declarations for CSS module imports used throughout the extension. */

// Lets TypeScript understand `import css from './x.module.css'` style imports.

declare module '*.module.css' {
	const classes: {[key: string]: string}
	export default classes
}

declare module '*.css'
