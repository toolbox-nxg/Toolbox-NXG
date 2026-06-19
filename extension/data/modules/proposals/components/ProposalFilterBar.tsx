/**
 * The sidebar filter/sort bar. Offers only the values actually present in the current
 * view (so a reviewer can't filter into an empty list), and a newest/oldest sort. State
 * lives in the parent drawer; this is a controlled, presentational component.
 */

import type {ProposalSource,} from '../../../util/wiki/schemas/proposals/schema'
import type {FilterOptions, ProposalFilters,} from './proposalFilter'
import css from './ProposalsReviewPopup.module.css'

/** Human label for a proposal source. */
function sourceLabel (source: ProposalSource,): string {
	return source === 'second-opinion' ? 'Second opinion' : 'Training'
}

/** Props for the filter bar. */
interface Props {
	/** The values selectable in each dropdown (derived from the current view). */
	options: FilterOptions
	/** The active selection. */
	filters: ProposalFilters
	/** Called with the next selection on any change. */
	onChange: (next: ProposalFilters,) => void
}

/** Renders the filter/sort controls. */
export function ProposalFilterBar ({options, filters, onChange,}: Props,) {
	return (
		<div className={css.filterBar}>
			{options.subreddits.length > 1 && (
				<select
					className={css.filterSelect}
					value={filters.subreddit}
					onChange={(e,) => onChange({...filters, subreddit: e.target.value,},)}
				>
					<option value="">All subreddits</option>
					{options.subreddits.map((subreddit,) => (
						<option key={subreddit} value={subreddit}>r/{subreddit}</option>
					))}
				</select>
			)}
			{options.actionTypes.length > 1 && (
				<select
					className={css.filterSelect}
					value={filters.actionType}
					onChange={(e,) =>
						onChange({...filters, actionType: e.target.value as ProposalFilters['actionType'],},)}
				>
					<option value="">All actions</option>
					{options.actionTypes.map(({value, label,},) => <option key={value} value={value}>{label}</option>)}
				</select>
			)}
			{options.sources.length > 1 && (
				<select
					className={css.filterSelect}
					value={filters.source}
					onChange={(e,) => onChange({...filters, source: e.target.value as ProposalFilters['source'],},)}
				>
					<option value="">All sources</option>
					{options.sources.map((source,) =>
						<option key={source} value={source}>{sourceLabel(source,)}</option>
					)}
				</select>
			)}
			<select
				className={css.filterSelect}
				value={filters.sort}
				onChange={(e,) => onChange({...filters, sort: e.target.value as ProposalFilters['sort'],},)}
			>
				<option value="newest">Newest first</option>
				<option value="oldest">Oldest first</option>
			</select>
		</div>
	)
}
