# Syntax Highlighter

**Platforms:** Old Reddit only · **Default:** Enabled

The Syntax Highlighter module adds syntax highlighting and code editor improvements to wiki edit pages on old Reddit.

## Overview

When you edit a wiki page on old Reddit, Syntax Highlighter replaces the plain textarea with an enhanced code editor. The language is determined by the wiki page path. Subreddit CSS editors also receive syntax highlighting. A selection of color themes is available.

## Features

**Wiki page syntax highlighting** — applies language-appropriate highlighting to wiki editor pages. The default mapping covers common pages (AutoModerator config as YAML, stylesheet as CSS, toolbox config as JSON, etc.) and you can add custom mappings.

**Word wrap** — optionally wraps long lines in the editor instead of scrolling horizontally.

**Theme selection** — choose from a range of syntax highlight color themes (default: Dracula).

## Settings

| Setting                | Default   | Description                             |
| ---------------------- | --------- | --------------------------------------- |
| Enable word wrap       | On        | Wrap long lines in the wiki editor      |
| Wiki page language map | see below | Page path → highlight language mappings |
| Syntax theme           | Dracula   | Color theme for the code editor         |

The default wiki page language map:

| Page                     | Language |
| ------------------------ | -------- |
| `config/automoderator`   | yaml     |
| `config/stylesheet`      | css      |
| `automoderator-schedule` | yaml     |
| `toolbox`                | json     |

Supported languages: `css`, `json`, `markdown` (alias: `md`), `yaml`.
