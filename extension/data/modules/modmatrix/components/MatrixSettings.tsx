/** Date-range picker and CSV download controls for the Mod Log Matrix. */

import {useState,} from 'react'
import css from '../modmatrix.module.css'
import type {MatrixState,} from '../schema'

function toDateString (date: Date,): string {
	return date.toJSON().slice(0, 10,)
}

function dateRangeToTimestamps (from: string, to: string,): {minDate: number; maxDate: number} {
	// Date-only strings ('YYYY-MM-DD') are parsed as UTC midnight by spec.
	// Use UTC methods throughout to avoid shifting into local time.
	const minDate = new Date(from,).getTime()
	const toDate = new Date(to,)
	toDate.setUTCDate(toDate.getUTCDate() + 1,)
	return {minDate, maxDate: toDate.getTime(),}
}

function today (): string {
	return toDateString(new Date(),)
}
function daysAgo (n: number,): string {
	const d = new Date()
	d.setUTCDate(d.getUTCDate() - n,)
	return toDateString(d,)
}
function thisMonthStart (): string {
	const d = new Date()
	d.setUTCDate(1,)
	return toDateString(d,)
}
function lastMonthRange (): {from: string; to: string} {
	const now = new Date()
	const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1,),)
	const lastOfLastMonth = new Date(firstOfThisMonth.getTime() - 1,)
	const firstOfLastMonth = new Date(Date.UTC(lastOfLastMonth.getUTCFullYear(), lastOfLastMonth.getUTCMonth(), 1,),)
	return {from: toDateString(firstOfLastMonth,), to: toDateString(lastOfLastMonth,),}
}

/** A named date-range shortcut for quick selection (e.g. "Last 7 days"). */
interface Preset {
	id: string
	label: string
	/** Returns the start date string in `YYYY-MM-DD` format. */
	from: () => string
	/** Returns the end date string in `YYYY-MM-DD` format. */
	to: () => string
}

const presets: Preset[] = [
	{id: '7d', label: '7d', from: () => daysAgo(6,), to: today,},
	{id: '30d', label: '30d', from: () => daysAgo(29,), to: today,},
	{id: '90d', label: '90d', from: () => daysAgo(89,), to: today,},
	{id: 'month', label: 'This month', from: thisMonthStart, to: today,},
	{id: 'lastmonth', label: 'Last month', from: () => lastMonthRange().from, to: () => lastMonthRange().to,},
]

/** Props for the {@link MatrixSettings} component. */
interface Props {
	state: MatrixState
	/** Data URI for the CSV download link, or `null` when no data has been generated yet. */
	csvUrl: string | null
	/**
	 * Called when the user submits the Generate form.
	 * @param minDate Start of range as a millisecond Unix timestamp.
	 * @param maxDate End of range as a millisecond Unix timestamp (inclusive day).
	 */
	onGenerate: (minDate: number, maxDate: number,) => void
}

/**
 * Renders the footer form with date-range presets, custom date inputs, a status line,
 * an optional CSV download link, and the Generate button.
 */
export function MatrixSettings ({state, csvUrl, onGenerate,}: Props,) {
	const [fromDate, setFromDate,] = useState(daysAgo(6,),)
	const [toDate, setToDate,] = useState(today(),)
	const [activePreset, setActivePreset,] = useState<string | null>('7d',)

	const todayStr = today()
	const {total, loading, error, firstEntry, lastEntry,} = state

	function handleSubmit (event: React.FormEvent,) {
		event.preventDefault()
		if (!fromDate || !toDate) { return }
		const {minDate, maxDate,} = dateRangeToTimestamps(fromDate, toDate,)
		onGenerate(minDate, maxDate,)
	}

	function applyPreset (preset: Preset,) {
		setFromDate(preset.from(),)
		setToDate(preset.to(),)
		setActivePreset(preset.id,)
	}

	let status = ''
	if (loading) {
		status = total > 0 ? `fetching... ${total.toLocaleString()} so far` : 'fetching...'
	} else if (firstEntry && lastEntry && total > 0) {
		const dateTimeOptions: Intl.DateTimeFormatOptions = {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZoneName: 'short',
		}
		const firstTimestamp = new Date(firstEntry.created_utc * 1000,).toLocaleString(undefined, dateTimeOptions,)
		const lastTimestamp = new Date(lastEntry.created_utc * 1000,).toLocaleString(undefined, dateTimeOptions,)
		status = `${total.toLocaleString()} actions · ${firstTimestamp} – ${lastTimestamp}`
	} else if (error) {
		status = 'error loading data'
	}

	return (
		<form onSubmit={handleSubmit} className={css.footerForm}>
			<div className={css.presets}>
				{presets.map((p,) => (
					<button
						key={p.id}
						type="button"
						className={activePreset === p.id ? css.presetActive : undefined}
						onClick={() => applyPreset(p,)}
					>
						{p.label}
					</button>
				))}
			</div>
			<input
				type="date"
				value={fromDate}
				max={todayStr}
				onChange={(e,) => {
					setFromDate(e.target.value,)
					setActivePreset(null,)
				}}
			/>
			<span>&#8211;</span>
			<input
				type="date"
				value={toDate}
				max={todayStr}
				onChange={(e,) => {
					setToDate(e.target.value,)
					setActivePreset(null,)
				}}
			/>
			<span className={css.footerStatus}>{status}</span>
			{csvUrl && (
				<a
					href={csvUrl}
					download={`${state.subredditName}-modlog.csv`}
					className={css.csvButton}
				>
					Download CSV
				</a>
			)}
			<input type="submit" value="Generate" disabled={loading} />
		</form>
	)
}
