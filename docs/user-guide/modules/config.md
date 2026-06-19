# Toolbox-NXG Config

**Platforms:** Old Reddit and New Reddit · **Default:** Enabled

The Config module provides the per-subreddit configuration overlay, letting moderators manage removal reasons, mod macros, usernote types, domain tags, and other subreddit-level settings.

## Overview

Open the config overlay from the Modbar — it is accessible on any subreddit page you moderate. Changes are saved to the subreddit wiki when you click Save. If 6.x compatibility writes are enabled, the save also updates the classic `toolbox` wiki page so moderators on the original Toolbox see the changes.

Each subreddit's configuration is independent. Toolbox-NXG stores it at `toolbox-nxg` in the subreddit wiki.

## Tabs

**Removal Reasons** — add, edit, reorder, and delete removal reasons. Each reason has a title, message text (with support for substitution tokens and interactive brace tokens), and reply-type settings. See [Removal Reasons](removal-reasons.md) for the token format.

**Mod Macros** — manage mod macros: pre-written messages with optional attached actions (remove, approve, ban, flair, distinguish, lock, sticky, archive modmail, and more). Macros appear in a dropdown inside reply areas. See [Mod Macros](macros.md) for details.

**Usernote Types** — configure the note type labels, colors, and dark-mode colors shown in the usernotes popup. Each type can optionally have an auto-ban duration and an auto-archive threshold. Built-in defaults are used when this list is empty.

**Usernotes settings** — choose what a usernote must contain before it can be saved in this subreddit (a type, body text, and/or a link to the content), and how those requirements apply to other moderators: _suggest_ them, _require_ them, or _leave_ it up to each moderator's personal settings. When the subreddit enforces requirements, the more restrictive of the subreddit's settings and a moderator's personal settings always wins. See [Usernotes](usernotes.md) for the matching personal settings.

**Domain Tags** — tag specific domains with a color. Tagged domains appear with a colored indicator on link posts in the mod queue and listings.

**General** _(subreddit-level)_ — subreddit-level settings such as log subreddit (logsub), ban message defaults, and compatibility mode toggle.

## Settings

The Config module has no personal settings of its own — all configuration lives in the subreddit wiki and is shared with all moderators.
