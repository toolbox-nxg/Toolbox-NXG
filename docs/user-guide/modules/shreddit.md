# Shreddit

**Platforms:** New Reddit only · **Default:** Enabled

The Shreddit module is the new-Reddit counterpart to the [Old Reddit](oldreddit.md) module. It activates on new Reddit (`www.reddit.com`, also served at `sh.reddit.com`) and is the foundation that the other new-Reddit modules build on. It also adds a couple of small quality-of-life fixes of its own.

## Overview

New Reddit (Shreddit) renders its UI as web components and swaps page content in and out without full page loads. The Shreddit module wires up Toolbox-NXG's UI location slots and watches the page for changes (new posts, comments, and navigations), so that every other module's buttons and overlays appear in the right place and survive Reddit's dynamic updates.

This is infrastructure that nearly everything else on new Reddit depends on, so it is enabled by default. Disabling it effectively turns Toolbox-NXG off on new Reddit.

## Features

Beyond bootstrapping the UI, the module restores author names that Reddit hides in some places:

**Feed-page usernames** — shows the author's name on feed pages (front page, r/popular, r/all, etc.), where Reddit normally omits it.

**Pinned-post usernames** — shows the author's name on pinned posts displayed in card mode.

## Settings

| Setting                       | Default | Description                                                                 |
| ----------------------------- | ------- | --------------------------------------------------------------------------- |
| Show usernames on feed pages  | On      | Show author names on feed pages (front page, r/popular, r/all, etc.)        |
| Show usernames on pinned posts| On      | Show author names on pinned posts shown in card mode                        |
