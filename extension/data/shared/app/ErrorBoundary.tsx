/** React error boundary that catches render errors and displays a fallback instead of crashing the tree. */

import {Component, ErrorInfo, ReactNode,} from 'react'
import createLogger from '../../util/infra/logging'

const log = createLogger('ErrorBoundary',)

interface Props {
	children: ReactNode
	/** Module or feature name shown in the fallback UI and error log. */
	name?: string | undefined
	/** Custom fallback element; defaults to a small inline error notice. */
	fallback?: ReactNode
}

interface State {
	error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
	override state: State = {error: null,}

	static getDerivedStateFromError (error: Error,): State {
		return {error,}
	}

	override componentDidCatch (error: Error, info: ErrorInfo,) {
		log.error(`[${this.props.name ?? 'unknown'}] React render error:`, error, info.componentStack,)
	}

	override render () {
		if (this.state.error) {
			if (this.props.fallback !== undefined) {
				return this.props.fallback
			}
			return (
				<span
					title={this.state.error.message}
					style={{color: '#c00', fontSize: '0.9167em', cursor: 'help',}}
				>
					[TB error{this.props.name ? ` in ${this.props.name}` : ''}]
				</span>
			)
		}
		return this.props.children
	}
}
