/** Renders a Material icon glyph from the Toolbox icon set as a React element. */

import {icons,} from '../../util/ui/icons'
import {classes,} from '../../util/ui/reactMount'
import css from './Icon.module.css'

/**
 * Renders a Material icon glyph.
 * @param props Component properties.
 * @param icon Name of the icon from the `icons` map.
 * @param mood Optional color tint: `'positive'` (green) or `'negative'` (red).
 * @param className Additional CSS class(es) applied to the `<i>` element.
 */
export const Icon = ({icon, mood, className,}: {
	icon: keyof typeof icons
	mood?: 'positive' | 'negative'
	className?: string
},) => (
	<i className={classes(css.icon, mood && css[mood], className,)}>
		{icons[icon]}
	</i>
)
