# Developer Tools

**Platforms:** Old Reddit and New Reddit · **Internal module**

:::{warning}
Developer Tools is intended for people working on Toolbox-NXG itself. It exposes low-level API inspection and UI testing utilities and is not meant for everyday moderation.
:::

## Overview

The Developer Tools module only appears in the settings overlay when **debug mode** is enabled (General Settings → Debug mode). For regular users with debug mode off, the module is hidden and inactive.

Once visible, its features are individually toggled from its settings tab. Both options are marked **Advanced**, so you may also need to enable "Show advanced settings" to see them.

## Features

**API helper buttons** — adds a small "api" button next to each element Toolbox-NXG receives from Reddit's front-end API, so you can inspect the underlying data for that post, comment, or user.

**Comment UI tester** — adds an entry to the right-click context menu that opens an overlay for exercising a variety of Toolbox-NXG UI components in isolation, which is useful when developing or debugging interface changes.

## Settings

| Setting           | Default | Description                                                                         |
| ----------------- | ------- | ----------------------------------------------------------------------------------- |
| API helper        | Off     | Show an "api" button next to each element received from Reddit's front-end API      |
| Comment UI tester | Off     | Add a context-menu item that opens an overlay for testing Toolbox-NXG UI components |
