<img align="right" width="128" src="extension/data/images/icon256.png">

# Moderator Toolbox-NXG for reddit

[![tests](https://github.com/toolbox-nxg/toolbox-nxg/actions/workflows/main.yml/badge.svg)](https://github.com/toolbox-nxg/toolbox-nxg/actions/workflows/main.yml)
[![DeepScan grade](https://deepscan.io/api/teams/30078/projects/31882/branches/1036395/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=30078&pid=31882&bid=1036395)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kglcfhgacmfabofjhbjlonpihkhonmkh?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/moderator-toolbox-nxg-for/kglcfhgacmfabofjhbjlonpihkhonmkh)
[![Mozilla Add-on](https://img.shields.io/amo/v/toolbox-nxg?label=Firefox)](https://addons.mozilla.org/en-US/firefox/addon/toolbox-nxg/)

A fork and near-complete reimplementation of [toolbox for reddit][upstream], providing a set of tools to help moderators do their jobs more effectively. While Toolbox-NXG originated from the upstream codebase, the vast majority of the code has been rewritten from scratch — retaining the core concepts and data formats while replacing the implementation with a modern, maintainable architecture. Toolbox-NXG extends the original with improvements to the wiki storage schema, a new usernotes layout with archiving support, a richer config editor, and ongoing refactors for maintainability.

> **Attribution:** Toolbox-NXG is derived from [toolbox for reddit][upstream], copyright the toolbox contributors, licensed under the [Apache License, Version 2.0][apache2]. Modifications have been made throughout.

Install Toolbox-NXG for Chrome (and other Chromium browsers such as Edge and Brave) from the [Chrome Web Store][chrome-store], or for Firefox from [Firefox Add-ons][firefox-store]. You can also install a build manually from [GitHub Releases][releases].

## Read the Documentation

Read the documentation for Toolbox-NXG [here](https://toolbox-nxg.github.io/Toolbox-NXG/).

## Reporting issues and feature requests

If you think you've found a bug, or want to suggest a new feature, please [make a post on /r/toolbox_nxg][post-on-reddit] or [open an issue on GitHub][issues].

## Building and Contributing

[Our contributing guide][contributing] has information about how to get Toolbox-NXG set up and running locally, an overview of the project structure, and information about our workflow. If you want to get involved in development, start there!

## Third-party Application Support

All Toolbox subreddit settings and data are stored in subreddit wikis through versioned JSON. Third-party applications can use this data to hook into Toolbox features like usernotes. Documentation for third-party developers looking to integrate with Toolbox-NXG can be found in [the schema reference section of our docs][third-party-docs], which describes the wiki JSON format for config, usernotes, subreddit notes, and more.

[upstream]: https://github.com/toolbox-team/reddit-moderator-toolbox
[apache2]: https://www.apache.org/licenses/LICENSE-2.0
[chrome-store]: https://chromewebstore.google.com/detail/moderator-toolbox-nxg-for/kglcfhgacmfabofjhbjlonpihkhonmkh
[firefox-store]: https://addons.mozilla.org/en-US/firefox/addon/toolbox-nxg/
[releases]: https://github.com/toolbox-nxg/toolbox-nxg/releases
[post-on-reddit]: https://www.reddit.com/r/toolbox_nxg/submit?text=true
[issues]: https://github.com/toolbox-nxg/toolbox-nxg/issues
[contributing]: https://toolbox-nxg.github.io/Toolbox-NXG/developer/contributing.html
[third-party-docs]: https://toolbox-nxg.github.io/Toolbox-NXG/schema/index.html
