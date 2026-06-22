/** Presentational table of ignored mod/user reports for a queue item. */
import css from './ActionDetails.module.css'

/**
 * Renders a table of mod and user reports for a queue item.
 * @param props Component properties.
 * @param modReports Mod reports as `[reportText, modUsername]` tuples.
 * @param userReports User reports as `[reportText, reportCount]` tuples.
 */
export function ReportsTable (
	{modReports, userReports,}: {
		modReports: Array<[string, string,]>
		userReports: Array<[string, string,]>
	},
) {
	const rows = [
		...modReports.map(([text, author,],) => ({type: 'mod', author, text,})),
		...userReports.map(([text, author,],) => ({type: 'user', author, text,})),
	]
	return (
		<table className={css.table}>
			<tbody>
				<tr>{['Type', 'Reporter', 'Report',].map((h,) => <th key={h}>{h}</th>)}</tr>
				{rows.map((r, i,) => (
					<tr key={`${r.type}${i}`} className={css.row}>
						<td>{r.type}</td>
						<td>{r.author}</td>
						<td>{r.text}</td>
					</tr>
				))}
			</tbody>
		</table>
	)
}
