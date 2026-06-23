/** Ambient module declaration for the tinycolor2 color library (typed to the surface Toolbox uses). */
declare module 'tinycolor2' {
	/** An RGBA color: r/g/b channels 0-255, alpha 0-1. */
	interface RgbColor {
		r: number
		g: number
		b: number
		a: number
	}
	/** An HSLA color: hue 0-360, saturation/lightness/alpha 0-1. */
	interface HslColor {
		h: number
		s: number
		l: number
		a: number
	}
	/** Any color form tinycolor accepts: a CSS string or a channel object. */
	type ColorInput =
		| string
		| {r: number; g: number; b: number; a?: number}
		| {h: number; s: number; l: number; a?: number}
		| {h: number; s: number; v: number; a?: number}
		| TinyColorInstance
	/** Options for the WCAG readability/contrast helpers. */
	interface ReadabilityOptions {
		level?: 'AA' | 'AAA'
		size?: 'small' | 'large'
	}
	/** A parsed color instance. */
	interface TinyColorInstance {
		toHexString(allow4Char?: boolean,): string
		toRgbString(): string
		toHslString(): string
		toRgb(): RgbColor
		toHsl(): HslColor
		isDark(): boolean
		isLight(): boolean
		isValid(): boolean
		getBrightness(): number
		getLuminance(): number
		setAlpha(alpha: number,): TinyColorInstance
		lighten(amount?: number,): TinyColorInstance
		darken(amount?: number,): TinyColorInstance
	}
	/** The callable tinycolor factory plus its static helpers. */
	interface TinyColorConstructor {
		(input?: ColorInput,): TinyColorInstance
		/** Returns whichever of `colorList` is most readable against `baseColor`. */
		mostReadable(baseColor: ColorInput, colorList: ColorInput[], options?: ReadabilityOptions,): TinyColorInstance
		/** True when `color1` meets the requested WCAG contrast against `color2`. */
		isReadable(color1: ColorInput, color2: ColorInput, options?: ReadabilityOptions,): boolean
	}
	const tinycolor: TinyColorConstructor
	export default tinycolor
}
