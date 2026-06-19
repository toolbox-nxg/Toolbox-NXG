/** Available CodeMirror theme names and helpers for the Syntax Highlighter module. */

/** Theme names corresponding to exports from @uiw/codemirror-themes-all. */
export const syntaxThemes = [
	'dracula',
	'abcdef',
	'abyss',
	'androidstudio',
	'andromeda',
	'atomone',
	'aura',
	'basicDark',
	'basicLight',
	'bbedit',
	'bespin',
	'consoleDark',
	'consoleLight',
	'copilot',
	'darcula',
	'eclipse',
	'githubDark',
	'githubLight',
	'gruvboxDark',
	'gruvboxLight',
	'kimbie',
	'material',
	'materialDark',
	'materialLight',
	'monokai',
	'monokaiDimmed',
	'noctisLilac',
	'nord',
	'okaidia',
	'quietlight',
	'red',
	'solarizedDark',
	'solarizedLight',
	'sublime',
	'tokyoNight',
	'tokyoNightDay',
	'tokyoNightStorm',
	'tomorrowNightBlue',
	'vscodeDark',
	'vscodeLight',
	'whiteDark',
	'whiteLight',
	'xcodeDark',
	'xcodeLight',
] as const

/** Union type of all valid CodeMirror theme names. */
export type SyntaxTheme = typeof syntaxThemes[number]

/** Creates a `<select>` element populated with all available syntax themes. */
export function createThemeSelectElement (): HTMLSelectElement {
	const select = document.createElement('select',)
	select.id = 'theme_selector'
	for (const theme of syntaxThemes) {
		const option = document.createElement('option',)
		option.value = theme
		option.textContent = theme
		select.appendChild(option,)
	}
	return select
}
