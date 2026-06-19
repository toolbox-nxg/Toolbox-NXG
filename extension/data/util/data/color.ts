/** Color utilities: best-contrast text color selection and HTML color name resolution. */

import tinycolor from 'tinycolor2'

const cache: Record<string, string> = {}

/**
 * Returns the most readable text color (black or white) for a given background color.
 * Results are memoized.
 */
export function getBestTextColor (bgColor: string,): string {
	if (!cache[bgColor]) {
		cache[bgColor] = tinycolor.mostReadable(bgColor, ['black', 'white',],).toHexString()
	}
	return cache[bgColor]!
}

/** Converts an HTML color name to its hex value, returning the input unchanged if not a known name. */
export function colorNameToHex (color: string,): string {
	const colorUPPERCASE = color.toUpperCase()

	const htmlColors: Record<string, string> = {
		ALICEBLUE: '#F0F8FF',
		ANTIQUEWHITE: '#FAEBD7',
		AQUA: '#00FFFF',
		AQUAMARINE: '#7FFFD4',
		AZURE: '#F0FFFF',
		BEIGE: '#F5F5DC',
		BISQUE: '#FFE4C4',
		BLACK: '#000000',
		BLANCHEDALMOND: '#FFEBCD',
		BLUE: '#0000FF',
		BLUEVIOLET: '#8A2BE2',
		BROWN: '#A52A2A',
		BURLYWOOD: '#DEB887',
		CADETBLUE: '#5F9EA0',
		CHARTREUSE: '#7FFF00',
		CHOCOLATE: '#D2691E',
		CORAL: '#FF7F50',
		CORNFLOWERBLUE: '#6495ED',
		CORNSILK: '#FFF8DC',
		CRIMSON: '#DC143C',
		CYAN: '#00FFFF',
		DARKBLUE: '#00008B',
		DARKCYAN: '#008B8B',
		DARKGOLDENROD: '#B8860B',
		DARKGRAY: '#A9A9A9',
		DARKGREY: '#A9A9A9',
		DARKGREEN: '#006400',
		DARKKHAKI: '#BDB76B',
		DARKMAGENTA: '#8B008B',
		DARKOLIVEGREEN: '#556B2F',
		DARKORANGE: '#FF8C00',
		DARKORCHID: '#9932CC',
		DARKRED: '#8B0000',
		DARKSALMON: '#E9967A',
		DARKSEAGREEN: '#8FBC8F',
		DARKSLATEBLUE: '#483D8B',
		DARKSLATEGRAY: '#2F4F4F',
		DARKSLATEGREY: '#2F4F4F',
		DARKTURQUOISE: '#00CED1',
		DARKVIOLET: '#9400D3',
		DEEPPINK: '#FF1493',
		DEEPSKYBLUE: '#00BFFF',
		DIMGRAY: '#696969',
		DIMGREY: '#696969',
		DODGERBLUE: '#1E90FF',
		FIREBRICK: '#B22222',
		FLORALWHITE: '#FFFAF0',
		FORESTGREEN: '#228B22',
		FUCHSIA: '#FF00FF',
		GAINSBORO: '#DCDCDC',
		GHOSTWHITE: '#F8F8FF',
		GOLD: '#FFD700',
		GOLDENROD: '#DAA520',
		GRAY: '#808080',
		GREY: '#808080',
		GREEN: '#008000',
		GREENYELLOW: '#ADFF2F',
		HONEYDEW: '#F0FFF0',
		HOTPINK: '#FF69B4',
		INDIANRED: '#CD5C5C',
		INDIGO: '#4B0082',
		IVORY: '#FFFFF0',
		KHAKI: '#F0E68C',
		LAVENDER: '#E6E6FA',
		LAVENDERBLUSH: '#FFF0F5',
		LAWNGREEN: '#7CFC00',
		LEMONCHIFFON: '#FFFACD',
		LIGHTBLUE: '#ADD8E6',
		LIGHTCORAL: '#F08080',
		LIGHTCYAN: '#E0FFFF',
		LIGHTGOLDENRODYELLOW: '#FAFAD2',
		LIGHTGRAY: '#D3D3D3',
		LIGHTGREY: '#D3D3D3',
		LIGHTGREEN: '#90EE90',
		LIGHTPINK: '#FFB6C1',
		LIGHTSALMON: '#FFA07A',
		LIGHTSEAGREEN: '#20B2AA',
		LIGHTSKYBLUE: '#87CEFA',
		LIGHTSLATEGRAY: '#778899',
		LIGHTSLATEGREY: '#778899',
		LIGHTSTEELBLUE: '#B0C4DE',
		LIGHTYELLOW: '#FFFFE0',
		LIME: '#00FF00',
		LIMEGREEN: '#32CD32',
		LINEN: '#FAF0E6',
		MAGENTA: '#FF00FF',
		MAROON: '#800000',
		MEDIUMAQUAMARINE: '#66CDAA',
		MEDIUMBLUE: '#0000CD',
		MEDIUMORCHID: '#BA55D3',
		MEDIUMPURPLE: '#9370DB',
		MEDIUMSEAGREEN: '#3CB371',
		MEDIUMSLATEBLUE: '#7B68EE',
		MEDIUMSPRINGGREEN: '#00FA9A',
		MEDIUMTURQUOISE: '#48D1CC',
		MEDIUMVIOLETRED: '#C71585',
		MIDNIGHTBLUE: '#191970',
		MINTCREAM: '#F5FFFA',
		MISTYROSE: '#FFE4E1',
		MOCCASIN: '#FFE4B5',
		NAVAJOWHITE: '#FFDEAD',
		NAVY: '#000080',
		OLDLACE: '#FDF5E6',
		OLIVE: '#808000',
		OLIVEDRAB: '#6B8E23',
		ORANGE: '#FFA500',
		ORANGERED: '#FF4500',
		ORCHID: '#DA70D6',
		PALEGOLDENROD: '#EEE8AA',
		PALEGREEN: '#98FB98',
		PALETURQUOISE: '#AFEEEE',
		PALEVIOLETRED: '#DB7093',
		PAPAYAWHIP: '#FFEFD5',
		PEACHPUFF: '#FFDAB9',
		PERU: '#CD853F',
		PINK: '#FFC0CB',
		PLUM: '#DDA0DD',
		POWDERBLUE: '#B0E0E6',
		PURPLE: '#800080',
		REBECCAPURPLE: '#663399',
		RED: '#FF0000',
		ROSYBROWN: '#BC8F8F',
		ROYALBLUE: '#4169E1',
		SADDLEBROWN: '#8B4513',
		SALMON: '#FA8072',
		SANDYBROWN: '#F4A460',
		SEAGREEN: '#2E8B57',
		SEASHELL: '#FFF5EE',
		SIENNA: '#A0522D',
		SILVER: '#C0C0C0',
		SKYBLUE: '#87CEEB',
		SLATEBLUE: '#6A5ACD',
		SLATEGRAY: '#708090',
		SLATEGREY: '#708090',
		SNOW: '#FFFAFA',
		SPRINGGREEN: '#00FF7F',
		STEELBLUE: '#4682B4',
		TAN: '#D2B48C',
		TEAL: '#008080',
		THISTLE: '#D8BFD8',
		TOMATO: '#FF6347',
		TURQUOISE: '#40E0D0',
		VIOLET: '#EE82EE',
		WHEAT: '#F5DEB3',
		WHITE: '#FFFFFF',
		WHITESMOKE: '#F5F5F5',
		YELLOW: '#FFFF00',
		YELLOWGREEN: '#9ACD32',
	}

	return Object.prototype.hasOwnProperty.call(htmlColors, colorUPPERCASE,) ? htmlColors[colorUPPERCASE]! : color
}

/**
 * Representative theme background colors that usernote tags and chips sit on
 * - the `--toolbox-action-bg` values from base.css. Used for readability
 * checks; keep in sync with the variable definitions there.
 */
export const LIGHT_THEME_BG = 'rgb(247 250 253)'
export const DARK_THEME_BG = 'rgb(17 27 38)'

/** Returns `true` when `color` meets WCAG AA small-text contrast against `bg`. */
export function isReadableOn (color: string, bg: string,): boolean {
	return tinycolor.isReadable(color, bg, {level: 'AA', size: 'small',},)
}

/**
 * Adjusts a color's lightness just far enough to meet WCAG AA small-text
 * contrast against `bg`, keeping its hue and saturation. Colors that already
 * pass are returned unchanged (normalized to hex). The lightness walks toward
 * white on dark backgrounds and toward black on light ones, so the loop
 * always terminates at a readable color.
 */
export function autoContrastColor (color: string, bg: string,): string {
	const parsed = tinycolor(color,)
	if (isReadableOn(color, bg,)) { return parsed.toHexString() }
	const step = tinycolor(bg,).isDark() ? 0.01 : -0.01
	const hsl = parsed.toHsl()
	while (hsl.l > 0 && hsl.l < 1) {
		hsl.l = Math.min(1, Math.max(0, hsl.l + step,),)
		const candidate = tinycolor(hsl,)
		if (isReadableOn(candidate.toHexString(), bg,)) { return candidate.toHexString() }
	}
	// Lightness hit an extreme without passing; fall back to plain black/white.
	return step > 0 ? '#ffffff' : '#000000'
}

/**
 * Computes the dark-mode variant of a color the way classic toolbox's
 * dark-mode container filter (`filter: invert(90%) hue-rotate(180deg)`) did:
 * a 90% channel inversion followed by the CSS filter spec's hue-rotate
 * matrix at 180°. Accepts any tinycolor-parseable color and returns hex.
 */
export function invertedDarkVariant (color: string,): string {
	const {r, g, b,} = tinycolor(color,).toRgb()
	// invert(90%): c -> c*0.1 + (255 - c)*0.9
	const inverted = [r, g, b,].map((c,) => 0.1 * c + 0.9 * (255 - c))
	// hue-rotate matrix at 180° (cos = -1, sin = 0)
	const matrix = [
		[-0.574, 1.430, 0.144,],
		[0.426, 0.430, 0.144,],
		[0.426, 1.430, -0.856,],
	]
	const [outR, outG, outB,] = matrix.map((row,) =>
		Math.max(
			0,
			Math.min(255, Math.round(row[0]! * inverted[0]! + row[1]! * inverted[1]! + row[2]! * inverted[2]!,),),
		)
	)
	return tinycolor({r: outR!, g: outG!, b: outB!,},).toHexString()
}
