# Mod Button

**Platforms:** Old Reddit and New Reddit · **Default:** Enabled

Mod Button registers moderation action buttons next to usernames, providing quick access to ban, mute, and other per-user actions.

## Overview

The Mod Button appears next to usernames on moderation pages. Clicking it opens a popup of actions you can take against that user in the current subreddit, and optionally in other subreddits you moderate. A global action button can optionally apply the same action across multiple subreddits at once.

## Features

**Per-user action popup** — ban (or change ban), add/remove approved submitter, mod/demod, and mute/unmute from a single popup next to any username. The popup also has **User Flair**, **Send Modmail**, and **User Modlog** tabs.

**Ban form** — the ban note, message and duration start from the subreddit's defaults in the Config overlay's **Ban settings** tab. If the subreddit has named ban macros, an **Apply ban macro...** picker fills the note, message and duration from one (replacing what's there). Tokens such as `{url}` or `{title}` that can't be filled (for example when the button was opened from a username rather than a post or comment) stay in the message as written, and a warning under the message names them so they're never sent by surprise. Pressing <kbd>Tab</kbd> in the ban note moves straight to the ban message. If the subreddit requires a ban message, the form won't ban with an empty one. A permanent ban can also **remove all posts & comments** the user made in the subreddit. By default a note saying so is added to the ban message; untick **Tell the user their posts & comments were removed** to leave it off for that ban. Like other bulk actions it isn't available in training mode.

**User Flair tab** — shows the user's current flair in the subreddit and the subreddit's user flair templates. Pick a template, or type text and a CSS class, then **Save Flair**. Choosing a template locks the CSS class to the template's. If Reddit won't return the flair or the templates, the footer says so rather than leaving the tab blank.

**Remember last action** — pre-selects the last action you used when you open the popup again.

**Saved subreddits** — pin subreddits so they are always listed in the popup, ready to tick when you want to apply the same action there too.

**Global Action button** _(advanced)_ — adds a button that applies the selected action across all moderated subreddits, with an exclusion list for subreddits you want to skip.

## Settings

| Setting                          | Default   | Description                                                         |
| -------------------------------- | --------- | ------------------------------------------------------------------- |
| Saved subreddits                 | _(empty)_ | Subreddits pinned to the Mod Button popup's subreddit list          |
| Remember last action             | Off       | Pre-select the last-used action when opening the popup              |
| Enable Global Action button      | Off       | Add a button for cross-subreddit actions _(advanced)_               |
| Exclude subs from Global Actions | _(empty)_ | Subreddits to skip when using the Global Action button _(advanced)_ |
