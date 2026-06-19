/** Renders a miniature SVG line chart of activity counts over time. */

/** Props for the {@link Sparkline} component. */
interface Props {
	/** Per-day action counts in chronological order. */
	counts: number[]
	width?: number
	height?: number
}

/** Renders a compact polyline SVG sparkline of `counts` values, scaling to fit the given dimensions. */
export function Sparkline ({counts, width = 60, height = 20,}: Props,) {
	if (counts.length === 0) { return <svg width={width} height={height} /> }

	const filled = Array.from({length: counts.length,}, (_, i,) => counts[i] ?? 0,)
	const max = Math.max(...filled, 1,)

	const points = filled.map((v, i,) => {
		const x = counts.length === 1 ? width / 2 : (i / (counts.length - 1)) * width
		const y = height - (v / max) * (height - 2) - 1
		return `${x.toFixed(1,)},${y.toFixed(1,)}`
	},).join(' ',)

	return (
		<svg width={width} height={height} style={{display: 'block', overflow: 'visible',}}>
			<polyline
				points={points}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
		</svg>
	)
}
