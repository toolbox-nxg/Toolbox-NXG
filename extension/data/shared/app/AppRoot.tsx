/** Root React component that wraps the entire Toolbox UI tree with the Redux store and top-level overlays. */

import {Provider,} from 'react-redux'

import store from '../../store/index'

import {PageNotificationContainer,} from './PageNotificationContainer'
import {SpinnerContainer,} from './SpinnerContainer'
import {TBContextMenu,} from './TBContextMenu'
import {TextFeedbackContainer,} from './TextFeedbackContainer'

/** Renders the Redux Provider and mounts all global Toolbox overlay containers. */
export default function () {
	return (
		<Provider store={store}>
			<div className="toolbox-app-root">
				<PageNotificationContainer />
				<TextFeedbackContainer />
				<SpinnerContainer />
				<TBContextMenu />
			</div>
		</Provider>
	)
}
