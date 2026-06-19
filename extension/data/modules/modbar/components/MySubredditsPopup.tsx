/** Slide-out drawer listing all subreddits the current user moderates, with quick-action links. */

import {useEffect, useMemo, useRef, useState,} from 'react'

import {Icon,} from '../../../shared/controls/Icon'
import {ShadowPortal,} from '../../../shared/window/ShadowPortal'
import {link,} from '../../../util/reddit/pageContext'
import {stringToColor,} from '../../../util/reddit/reddit-domain'

import css from './MySubredditsPopup.module.css'

/** Props for the MySubredditsPopup component. */
export interface MySubredditsPopupProps {
	/** The list of subreddits the current user moderates. */
	subs: {subreddit: string}[]
	/** Salt value mixed into the subreddit name when generating the per-row accent color. */
	subredditColorSalt: string
	/** Whether the Config module is enabled (shows a config icon per subreddit when `true`). */
	configEnabled: boolean
	/** Whether the Usernotes module is enabled (shows a usernotes icon per subreddit when `true`). */
	usernotesEnabled: boolean
	/**
	 * Per-subreddit modqueue item counts keyed by lowercase subreddit name, used to
	 * render a badge on each row's modqueue icon. Sourced from the notifier poll, so
	 * subreddits outside the notifier's multireddit (or with an empty queue) are absent.
	 */
	queueCounts: Record<string, number>
	onClose: () => void
}

/** Renders the "Subreddits you moderate" slide-out drawer with filtering and per-sub action links. */
export function MySubredditsPopup ({
	subs,
	subredditColorSalt,
	configEnabled,
	usernotesEnabled,
	queueCounts,
	onClose,
}: MySubredditsPopupProps,) {
	const [filter, setFilter,] = useState('',)
	const filterInputRef = useRef<HTMLInputElement>(null,)

	useEffect(() => {
		filterInputRef.current?.focus()
	}, [],)

	const colored = useMemo(
		() =>
			subs.map((s,) => ({
				name: s.subreddit,
				color: stringToColor(s.subreddit + subredditColorSalt,),
			})),
		[subs, subredditColorSalt,],
	)

	const filtered = useMemo(() => {
		const upper = filter.toUpperCase()
		return colored.filter((s,) => !upper || s.name.toUpperCase().includes(upper,))
	}, [colored, filter,],)

	return (
		<ShadowPortal>
			<div className={css.drawer}>
				<div className={css.header}>
					<span>Subreddits you moderate</span>
					<button type="button" aria-label="Close" className={css.closeButton} onClick={onClose}>
						<Icon icon="close" />
					</button>
				</div>
				<div className={css.filterBar}>
					<input
						ref={filterInputRef}
						type="text"
						className={css.filterInput}
						placeholder="Filter subreddits..."
						value={filter}
						onChange={(event,) => setFilter(event.target.value,)}
					/>
					<span className={css.filterCount}>{filtered.length}</span>
				</div>
				<div className={css.body}>
					<ul className={css.list} aria-label="Subreddits you moderate">
						{filtered.map(({name, color,},) => (
							<li
								key={name}
								className={css.row}
								style={{borderLeft: `solid 3px ${color}`,}}
								data-subreddit={name}
							>
								<a
									className={css.subName}
									title={`/r/${name}`}
									href={link(`/r/${name}`,)}
									target="_blank"
									rel="noreferrer"
								>
									/r/{name}
								</a>
								<div className={css.subActions} role="group" aria-label={`Actions for /r/${name}`}>
									<a
										title={`/r/${name} modqueue`}
										target="_blank"
										rel="noreferrer"
										href={link(`/r/${name}/about/modqueue`,)}
										className={`toolbox-icons ${css.queueLink}`}
										onClick={(e,) => {
											if (e.ctrlKey || e.metaKey) { return }
											const queueEvent = new CustomEvent('tb:mysubs-open-queue', {
												cancelable: true,
												detail: {subreddit: name, type: 'modqueue',},
											},)
											document.dispatchEvent(queueEvent,)
											if (queueEvent.defaultPrevented) { e.preventDefault() }
										}}
									>
										<Icon icon="modqueue" />
										<span className={css.queueChipSlot}>
											{(queueCounts[name.toLowerCase()] ?? 0) > 0 && (
												<span
													className={css.queueChip}
													aria-label={`${queueCounts[name.toLowerCase()]} items in modqueue`}
												>
													{queueCounts[name.toLowerCase()]}
												</span>
											)}
										</span>
									</a>
									<a
										title={`/r/${name} unmoderated`}
										target="_blank"
										rel="noreferrer"
										href={link(`/r/${name}/about/unmoderated`,)}
										className="toolbox-icons"
										onClick={(e,) => {
											if (e.ctrlKey || e.metaKey) { return }
											const queueEvent = new CustomEvent('tb:mysubs-open-queue', {
												cancelable: true,
												detail: {subreddit: name, type: 'unmoderated',},
											},)
											document.dispatchEvent(queueEvent,)
											if (queueEvent.defaultPrevented) { e.preventDefault() }
										}}
									>
										<Icon icon="unmoderated" />
									</a>
									<a
										title={`/r/${name} moderation log`}
										target="_blank"
										rel="noreferrer"
										href={link(`/r/${name}/about/log`,)}
										data-type="modlog"
										data-subreddit={name}
										className="toolbox-icons"
									>
										<Icon icon="modlog" />
									</a>
									<a
										title={`/r/${name} traffic stats`}
										target="_blank"
										rel="noreferrer"
										href={link(`/r/${name}/about/traffic`,)}
										data-type="traffic"
										data-subreddit={name}
										className="toolbox-icons"
									>
										<Icon icon="subTraffic" />
									</a>
									{usernotesEnabled && (
										<button
											type="button"
											title={`/r/${name} usernotes`}
											className={css.subActionButton}
											onClick={() =>
												document.dispatchEvent(
													new CustomEvent('tb:mysubs-open-usernotes', {
														detail: {subreddit: name,},
													},),
												)}
										>
											<Icon icon="usernote" />
										</button>
									)}
									{configEnabled && (
										<button
											type="button"
											title={`/r/${name} config`}
											className={css.subActionButton}
											onClick={() =>
												document.dispatchEvent(
													new CustomEvent('tb:mysubs-open-config', {
														detail: {subreddit: name,},
													},),
												)}
										>
											<Icon icon="tbSubConfig" />
										</button>
									)}
								</div>
							</li>
						))}
					</ul>
				</div>
			</div>
		</ShadowPortal>
	)
}
