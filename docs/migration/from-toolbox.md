# Migrating from Original Toolbox

Toolbox-NXG is a drop-in replacement for the original Toolbox for Reddit. Your existing subreddit configuration, usernotes, and personal settings are compatible and will continue to work without any action on your part.

This page covers the new features and behaviour changes you'll encounter after switching.

## Installation

Install Toolbox-NXG from the [Chrome Web Store](https://chromewebstore.google.com/detail/moderator-toolbox-nxg-for/kglcfhgacmfabofjhbjlonpihkhonmkh) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/toolbox-nxg/) — see the [installation guide](../user-guide/installation.md) for details. If you currently use the original Toolbox, disable or remove it before enabling Toolbox-NXG to avoid conflicts.

## What's new in NXG

### New Reddit support

NXG runs on both old Reddit (`old.reddit.com`) and new Reddit / Shreddit (`sh.reddit.com`); Old Reddit is treated as first-class, and Shreddit support as practical. Most modules work on both; a handful are platform-specific and their pages note which they support.

### Subreddit Notes

Subreddit Notes is an extention of the personal notes module from Toolbox (disabled by default) that provides wiki-backed shared notes at the subreddit level, visible to all moderators. Unlike usernotes, which are attached to users, subreddit notes are free-form text attached to the subreddit itself — useful for pinning team procedures, escalation contacts, or anything else the mod team needs to share.

### Removal reasons drawer

The removal reasons dialog is now a sliding side drawer by default, replacing the old modal popup. The drawer keeps the page context visible while you select a reason and compose your message. The legacy popup is still available as an option in the Removal Reasons settings if you prefer it.

### Queue item persistence

In NXG, queue items are not hidden the moment you click the removal button. The item stays visible so you can review the reason, adjust the message, or change your mind — it only disappears from the queue once you confirm the action. This gives you a clear window to back out without any consequence.

### Modqueue enhancements

NXG adds quality-of-life improvements to the modqueue:

- **Near-realtime updates** - the queue refreshes in the background and surfaces actions taken by other moderators without requiring a manual page reload, so you and your team stay in sync without accidentally duplicating work.
- **Per-subreddit sort order** - The ability to group items by subreddit in modqueue.
- **Live-updating modqueue** - With auto-refresh turned on, new items are loaded into your modqueue as they appear.

### Usernote archiving

Notes can now be now archived instead of deleted. An archived note is hidden by default but kept permanently — useful when a user's situation improves and you want to retain a record of prior actions without cluttering the active note list.

Archiving can happen in three ways:

- **Manually** — press the archive button on any note in the usernotes popup.
- **Auto-archive by type** — each usernote type can have an `autoArchiveDays` threshold. Notes older than the threshold are archived automatically on every save.
- **Legacy-delete reconciliation** — when a moderator still on original Toolbox deletes a note, NXG detects the deletion and archives the note rather than losing it.

### Unlimited usernote storage

Original Toolbox stores all usernotes in a single wiki page, which Reddit caps at 1 MB — a hard ceiling that active subreddits can hit. NXG removes this limit by automatically sharding usernotes across multiple wiki pages as needed. Each shard is transparent to you; the usernotes popup, archiving, and sync features all work the same way regardless of how many shards are in use.

### Usernote and ban integration

When leaving a usernote, you can optionally issue a ban at the same time — the ban form is embedded in the usernote flow so you don't have to navigate away and fill out the same context twice. NXG also lets you attach a link to the associated removal notice as part of the note, keeping a permanent record of what was sent alongside the note itself.

### Dark-mode note type colors

Each usernote type now has an optional separate dark-mode color. The built-in default types ship with hand-tuned dark variants. Custom types you create in the config editor can also specify a dark color.

### Modmail enhancements (new Reddit)

On new Reddit's modmail, NXG adds:

- **Mod macros** — a macro picker next to the saved-responses dropdown, letting you insert and token-substitute your mod macros directly into the composer.
- **Markdown preview** — the preview button is automatically engaged when you start typing, so you see formatted output without an extra click.
- **Search bar always visible** — the modmail search bar stays pinned at the top instead of being hidden behind a toggle button.
- **Recent message timestamps** — messages less than 24 hours old show an exact time alongside the date.

### Richer removal reason format

Removal reason text now uses brace tokens for interactive fill-in fields instead of raw HTML elements:

- `{input: placeholder}` — single-line text field
- `{textarea: placeholder}` — multi-line text field
- `{select:name}` — dropdown menu, with options defined separately in the reason

Existing reasons using the old `<input>` / `<textarea>` / `<select>` HTML tags are automatically converted to the new format on the next config save.

## New wiki layout and compatibility

NXG stores subreddit data on new `toolbox-nxg` wiki pages alongside the originals. This migration happens automatically when a mod with wiki-edit permissions first views a subreddit — your existing `toolbox` pages are never deleted.

By default, NXG also keeps the original `toolbox` page in sync on every save, so moderators still using original Toolbox on the same subreddit continue to see up-to-date data. You can toggle this per-subreddit from the NXG settings overlay.

For full technical details, see [Schema Changes](schema-changes.md).

## Data compatibility

Your existing config, usernotes, and personal settings carry over automatically:

- **Subreddit config** (removal reasons, mod macros, usernote types, domain tags) — read and up-converted on first access; no manual steps needed.
- **Usernotes** — migrated to the new layout on first access; the original `usernotes` page is left untouched.
- **Personal settings** — can be restored from your personal subreddit if you backed them up in Legacy Toolbox.

## Known limitations

- **6.x compatibility and the 1 MB limit** — subreddits whose active usernotes exceed 1 MB cannot keep the original `toolbox` usernotes page in sync; the legacy page's size allowance is the binding constraint.
- **Archived notes are NXG-only** — archived notes are stripped from the legacy `toolbox` usernotes mirror and will not be visible to mods running original Toolbox.
