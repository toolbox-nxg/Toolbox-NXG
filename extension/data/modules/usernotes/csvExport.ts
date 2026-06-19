/** CSV export utility for usernotes data. */

import {UsernotesUser,} from '../../util/wiki/schemas/usernotes/schema'

function cell (value: string,): string {
	if (value.includes(',',) || value.includes('"',) || value.includes('\n',)) {
		return `"${value.replace(/"/g, '""',)}"`
	}
	return value
}

/**
 * Generates a CSV file from all usernotes for a subreddit and triggers a
 * browser download. Every note is exported, including archived ones, with
 * their status and attribution in dedicated columns.
 * @param subreddit Subreddit name, used in the downloaded filename.
 * @param users All users whose notes should be included.
 */
export function exportUsernotesCsv (subreddit: string, users: UsernotesUser[],): void {
	const rows: string[] = [
		[
			'subreddit',
			'username',
			'index',
			'note',
			'time',
			'type',
			'mod',
			'link',
			'status',
			'status_by',
			'status_at',
		].join(',',),
	]

	for (const user of users) {
		for (const note of user.notes) {
			const status = note.archived ? 'archived' : 'active'
			const attribution = note.archived
			rows.push([
				cell(subreddit,),
				cell(user.name,),
				cell(note.index !== undefined ? String(note.index,) : '',),
				cell(note.note,),
				cell(new Date(note.time * 1000,).toISOString(),),
				cell(note.type ?? '',),
				cell(note.mod,),
				cell(note.link ?? '',),
				cell(status,),
				cell(attribution?.by ?? '',),
				cell(attribution ? new Date(attribution.at * 1000,).toISOString() : '',),
			].join(',',),)
		}
	}

	const blob = new Blob([rows.join('\n',),], {type: 'text/csv;charset=utf-8;',},)
	const url = URL.createObjectURL(blob,)
	const a = document.createElement('a',)
	a.href = url
	a.download = `usernotes-${subreddit}-${new Date().toISOString().slice(0, 10,)}.csv`
	document.body.appendChild(a,)
	a.click()
	document.body.removeChild(a,)
	URL.revokeObjectURL(url,)
}
