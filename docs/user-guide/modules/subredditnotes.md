# Subreddit Notes

**Platforms:** Old Reddit and New Reddit · **Default:** Disabled

Subreddit Notes provides wiki-backed shared notes at the subreddit level, visible to all moderators of that subreddit.

## Overview

Subreddit Notes is a new module introduced in Toolbox-NXG with no equivalent in the original Toolbox. Unlike usernotes (which are attached to user accounts), subreddit notes are free-form documents attached to the subreddit itself — useful for pinning team procedures, escalation contacts, ban templates, or any other information moderators need to share.

Notes are stored on the subreddit wiki and are accessible to all moderators of that subreddit. Each note is a separate wiki page with its own title, tags, and content; an index page (`toolbox-nxg/notes/index`) lists all notes for easy navigation.

Access the Subreddit Notes panel from the Modbar.

## Features

**Per-subreddit note library** — create, edit, archive, and delete notes from within the browser, without visiting the wiki directly.

**Tags** — add arbitrary tags to notes for filtering. The index maintains a sorted tag list for fast filtering.

**Archived notes** — notes can be archived (hidden but kept) without deleting them permanently.

**Author and date tracking** — each note records who created it and when, and tracks the last-updated timestamp.

**Search and filter** — filter the note list by keyword, tag, or author.

**Sortable** — sort notes by title or last-updated date.

**Monospace editor** — optionally use a monospace font in the note editor for text-based tables or code snippets.

**Default subreddit** — configure a default subreddit for the notes panel, so it opens to that subreddit's notes without requiring selection each time.

## Settings

| Setting                      | Default   | Description                                                    |
| ---------------------------- | --------- | -------------------------------------------------------------- |
| Default subreddit for notes  | _(empty)_ | Subreddit to open notes for by default                         |
| Default to current subreddit | Off       | When on a subreddit you moderate, open its notes automatically |
| Monospace font in editor     | Off       | Use a monospace font in the note text editor                   |
