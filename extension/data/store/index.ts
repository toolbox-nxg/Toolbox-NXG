/** Configures the Redux store with all Toolbox slice reducers and exports typed helpers. */

import {
	combineReducers,
	configureStore,
	createListenerMiddleware,
	type ThunkAction,
	type UnknownAction,
} from '@reduxjs/toolkit'
import contextMenuReducer from './contextMenuSlice'
import settingsReducer, {loadSettings,} from './settingsSlice'
import spinnerReducer from './spinnerSlice'
import textFeedbackReducer, {clearTextFeedback, showTextFeedback,} from './textFeedbackSlice'

const listenerMiddleware = createListenerMiddleware()

const rootReducer = combineReducers({
	textFeedback: textFeedbackReducer,
	settings: settingsReducer,
	spinner: spinnerReducer,
	contextMenu: contextMenuReducer,
},)

const store = configureStore({
	reducer: rootReducer,
	middleware: (getDefaultMiddleware,) => getDefaultMiddleware().prepend(listenerMiddleware.middleware,),
},)
export default store

// Auto-dismiss text feedback after the requested duration.
// cancelActiveListeners ensures only one dismiss timer runs at a time.
listenerMiddleware.startListening({
	actionCreator: showTextFeedback,
	effect: async (action, listenerApi,) => {
		listenerApi.cancelActiveListeners()
		await listenerApi.delay(action.payload.duration ?? 3000,)
		listenerApi.dispatch(clearTextFeedback(),)
	},
},)

// Kick off the initial settings load from storage right away
void store.dispatch(loadSettings(),)

/** The combined state type for all Toolbox reducers. */
export type RootState = ReturnType<typeof rootReducer>
/** Typed dispatch function for the Toolbox store. */
export type AppDispatch = typeof store.dispatch
/** Typed thunk action creator helper. */
export type AppThunk<ReturnType = void,> = ThunkAction<
	ReturnType,
	RootState,
	unknown,
	UnknownAction
>
