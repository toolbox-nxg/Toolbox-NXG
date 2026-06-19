/** Imperative React-based alert dialog that resolves a promise when the user confirms or dismisses it. */

import {createRoot,} from 'react-dom/client'

import {Backdrop,} from '../window/Backdrop'
import {Window,} from '../window/Window'

/**
 * Shows a modal alert dialog with an OK button.
 * @returns A promise that resolves to `true` when OK is clicked, `false` when dismissed.
 */
export function reactAlert ({message,}: {message: string},): Promise<boolean> {
	return new Promise((resolve,) => {
		const container = document.createElement('div',)
		document.body.appendChild(container,)
		const root = createRoot(container,)

		function cleanup (result: boolean,) {
			root.unmount()
			container.remove()
			resolve(result,)
		}

		root.render(
			<Backdrop onClickOutside={() => cleanup(false,)}>
				<Window
					title="Toolbox"
					onClose={() => cleanup(false,)}
					footer={<button onClick={() => cleanup(true,)}>OK</button>}
				>
					<p>{message}</p>
				</Window>
			</Backdrop>,
		)
	},)
}
