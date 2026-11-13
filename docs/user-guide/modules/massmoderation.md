# Mass Moderation

**Platforms:** Old Reddit only · **Default:** Enabled

Mass Moderation adds queue management tools to old Reddit moderation pages, letting moderators sort, filter, and act on multiple queue items at once.

## Overview

Mass Moderation is an old Reddit-only module. It activates on mod queue and unmoderated pages and adds a toolbar of controls above the listing. Items can be sorted and filtered without reloading, and auto-refresh keeps the queue up to date.

The toolbar stays pinned to the top of the window as you scroll. If RES pins the subreddit bar, user bar or header (Appearance → betterReddit), the toolbar sits just below it instead of being covered.

## Features

**Sort and filter** — sort queue items by age, edited time, removal time, score, report count, or author username. Items with fewer reports than the reports threshold, or a score above the score threshold, can be hidden.

**Select or filter by criteria** — the **select...** button (Alt+L) opens a panel for picking out items by:

- **Type:** text posts, link posts, comments, posts with flair.
- **State:** spam-filtered, shadow-banned, handled by another mod, or approved, removed, spammed or reports ignored on this page.
- **Users, domains and subreddits:** comma-separated lists. Users and subreddits match exactly; a domain also matches its subdomains, so `youtube.com` covers `m.youtube.com`.
- **Text:** title, flair or report text contains a phrase.
- **Numbers:** at least N reports, score above or below a value, or older or newer than a number of hours. Items whose score is hidden never match a score rule.

Ticking several boxes in one row matches any of them; filling in several rows requires all of them. Each row has a **not** box that flips it, for example "users not alice, bob". Matching ignores case. While the panel is open, the matching items are outlined and a count shows how many match.

The panel has two modes; it remembers which you used last, and the criteria you last applied:

- **Show only matching** (the default) hides everything else. Items that arrive on auto-refresh are filtered too. A chip in the toolbar shows the filter is on; click its ✕ to clear it. The filter lasts until you leave or reload the page, and **unhide all** doesn't undo it.
- **Select matching** ticks the matching items. **select** replaces the current selection, **add** adds to it, and **deselect** unticks the matching items.

Items the filter hides are unticked and are never selected or included in a bulk action, so a filter followed by select-all only acts on what you can see. The posts and comments toggle still works on its own, and the filter applies on top of it.

**Hide actioned items** — removes items from the listing after you take action on them, so the queue shrinks as you work through it.

**Items handled elsewhere** — when the mod log shows an item was approved or removed by another moderator (or by you on another page), the queue recolors it, labels its button "Approved by …" or "Removed by …", unticks it, and fades it. That includes an item another mod handled just before the queue finished loading. These items are never hidden automatically, since that would shift the page under your cursor: click **hide handled** in the toolbar to clear them all at once, and **unhide all** to bring them back. The mod log is checked after each of your own actions and on every auto-refresh tick.

**Group by subreddit** — groups queue items from the same subreddit together.

**Group comments by submission** — when viewing a comment queue, groups each comment under its parent submission.

**Auto-refresh** — periodically reloads queue items so new reports appear without a manual page refresh. It checks often while things are changing and backs off when they aren't, pauses while the tab is in the background, and checks straight away when you return to it.

**Expand reports** — automatically expands the report details for every item when the page loads.

**Link to subreddit queue** — adds a link to each item's subreddit mod queue for quick drill-down.

**Expand or collapse all** — the toolbar's **expand all** button opens every expando box on the page. Text posts load together in a single request; link and media posts open one per second, because Reddit leaves them empty when they're opened faster. **collapse all** hides them without discarding what's loaded, so expanding them again is instant and doesn't reload images or embeds.

**Keep expandos open** — opens all expando boxes on queue pages by default.

## Settings

| Setting                      | Default | Description                                                                                    |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| Automatically activate       | On      | Activate mass moderation tools on queue pages automatically                                    |
| Expand reports               | Off     | Auto-expand reports on mod pages                                                               |
| Hide actioned items          | Off     | Hide items after taking a mod action                                                           |
| Link to subreddit queue      | Off     | Show link to the subreddit queue on mod pages                                                  |
| Sort by                      | Age     | Default sort order for queue items (age, edited, removed, score, reports, author) _(advanced)_ |
| Reports threshold            | 0       | Hide items with fewer reports than this (0 = show all) _(advanced)_                            |
| Sort ascending               | Off     | Sort in ascending order _(advanced)_                                                           |
| Group comments by submission | Off     | Group comment-queue items by their parent post _(advanced)_                                    |
| Keep expandos open           | Off     | Keep all media expandos open by default _(advanced)_                                           |
| Score threshold              | 0       | Hide items with score above this value (0 = disabled) _(advanced)_                             |
| Prevent re-sort on load      | Off     | Lock the current sort when new items load _(advanced)_                                         |
| Group by subreddit           | Off     | Group queue items by subreddit _(advanced)_                                                    |
| Auto-refresh                 | Off     | Auto-refresh queue items periodically _(advanced)_                                             |
| Bulk action confirmation     | 10      | Ask before a bulk action on this many or more selected items (0 = never ask)                   |
