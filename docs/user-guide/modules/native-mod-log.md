# Native Mod Log

**Platforms:** Old Reddit and New Reddit · **Default:** Disabled

Native Mod Log shows Reddit's own per-user mod log — the native mod notes moderators leave and the mod actions taken against a user — right next to their username. It is separate from [Usernotes](usernotes.md), which are Toolbox's own notes stored in the subreddit wiki; the two can be turned on and off independently, and each has its own button.

Toolbox 7.x users will know this as the **Mod Notes** module.

## Overview

When enabled, an **NN** tag appears next to usernames in subreddits you moderate. If the user has a native mod log entry, the tag shows the latest one instead:

- a **note** shows its text, colored by its label (Ban in red, Spam Watch in fuchsia, and so on);
- a **mod action** shows the action type, in italics;
- one of Reddit's **AI-generated user summaries** shows as "AI summary" (when they are turned on — see [Settings](#settings)), with the full text in the tooltip.

Lookups are batched, so a page full of usernames costs only a request or two.

## The mod log popup

Click the tag to open the user's native mod log for that subreddit. It has three tabs:

- **All Activity** — notes and mod actions together, newest first;
- **Notes** — only mod notes;
- **Mod Actions** — only mod actions (removals, bans, approvals, ...).

Each entry links to the post or comment it is about, where there is one. Notes can be deleted from the list. Entries show how long ago they happened; to see the date as well, change **Time format** in [General Settings](general.md#time-format).

### Adding a note

Below the tabs, pick a label (optional), type the note, and click **Save for /r/...**. A note added from a post or comment is attached to it. Reddit limits a mod note to 250 characters.

Choosing the **Ban** or **Permaban** label also offers to ban the user at the same time, with an optional ban message (and a duration for Ban). The ban option is turned on when you pick the label; turn off **Turn on the ban option for Ban and Permaban** to have it start off instead, so you tick it only when you mean to ban. The message and duration start from the subreddit's defaults in the Config overlay's **Ban settings** tab. When the popup was opened from a post or comment, the ban is linked to it, so the ban message points the user at it. Moderators can't be banned, so the option is disabled for them. A subreddit can remove the option for every mod by ticking **Don't offer a ban with native notes** in the Config overlay's **Ban settings** tab; Ban and Permaban then add a note only. If the subreddit has named ban macros (Config overlay, **Ban settings** tab), an **Apply ban macro...** picker fills the ban message, and the duration for Ban, from one.

To set a Ban's duration from what you type in the note, enter a regular expression in the advanced **Read the ban duration from the note** setting. Its first capture group holds the days and case is ignored. For example, `^\s*([\d.,]+)\s*d\b` reads 5 days from a note starting "5d spam" or "5 d spam".

Make the capture group broader than whole numbers, as this example does with `[\d.,]+`. Then a duration like "1.5d" is caught and flagged instead of being missed. A pattern that only matches `\d+` doesn't match "1.5d" at all, so the ban would quietly use the default duration.

Next to the duration you'll see **(from note)** while it comes from the note, and **(default, not from note)** when the note didn't match. Check it before you save. The note and the duration stay in step: typing a duration yourself or applying a ban macro rewrites the duration in the note (so "5d spam" becomes "57d spam"), and editing the duration in the note changes the ban. When the note has no duration, the one you typed or took from a macro is used. A note whose duration isn't a whole number of at least 1 day can't be saved with a ban until you fix it, either in the note or by typing a duration.

Reddit bans for at most 999 days. A note can still record a longer duration, such as "1500d ban evasion": Toolbox shows what the note says and offers a **Ban for 999 days** button. Click it to save the note as written with a 999-day ban. Nothing is saved until you do, so a typo like "1000d" for "100d" can't quietly become a much longer ban, and if you change the number in the note afterwards, you're asked again. To ban for less instead, type the duration; the note is rewritten to match, as usual. A pattern that isn't a valid regular expression is ignored and flagged next to the duration.

## The mod log in other places

The mod button's **User Modlog** tab shows a user's mod actions whether or not this module is enabled — it only loads when you open the tab. The same goes for the **Log** section of the Modmail user sidebar.

Removal reasons can write the removal's note as a Reddit mod note instead of a Toolbox note, but only while this module is enabled; see [Removal Reasons](removal-reasons.md).

## Settings

| Setting                                     | Default      | Description                                                                                             |
| ------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| Default tab                                 | All Activity | Which tab the popup opens on                                                                            |
| Default native note label                   | None         | Label preselected for new notes                                                                         |
| Notes tab layout                            | Cards        | Cards, or Table to lay the Notes tab out like All Activity and Mod Actions                              |
| Turn on the ban option for Ban and Permaban | On           | Whether choosing the Ban or Permaban label starts with "Issue ban" ticked; off means you tick it to ban |
| Show AI summaries                           | Off          | Show Reddit's AI-generated user summaries on the NN tag and in the popup                                |
| Show mod actions                            | On           | Show mod actions alongside notes on the NN tag and in the popup; when off, only the Notes tab shows     |
| Read the ban duration from the note         | Empty        | Advanced. A regular expression that reads a Ban's duration in days from the note text (see above)       |
| Max note characters                         | 20           | Advanced. How much of the latest note the NN tag shows before truncating (full text on hover)           |

Reddit only reports the single latest entry for the tag, so if that entry is one you have hidden, the tag shows **NN** rather than an older entry.
