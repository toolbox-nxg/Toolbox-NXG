# Custom CSS

**Platforms:** Old Reddit and New Reddit · **Default:** Disabled

Custom CSS lets you change how Toolbox looks for you alone, without changing it for everyone.

## Overview

Turn the module on and type your CSS into its settings tab. When you save, the CSS is applied to Reddit's page and to every Toolbox window, including popups. Turning the module off stops applying your CSS without deleting it, which is a quick way to check whether your CSS is behind something that looks wrong.

Custom CSS is unsupported: a Toolbox update can change what your rules match. The selectors below are the exception. They are kept stable, and a change to them will be noted in the release notes.

| Selector                      | Matches                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `.toolbox-bottombar`          | The modbar                                                 |
| `.toolbox-counter-badge`      | The modmail, modqueue and unmoderated counts in the modbar |
| `.toolbox-modmailcount`       | The link around the modmail count                          |
| `.toolbox-queueCount`         | The link around the modqueue count                         |
| `.toolbox-unmoderatedCount`   | The link around the unmoderated count                      |
| `.toolbox-prerelease-link`    | The version label shown on beta builds                     |
| `.toolbox-theme-classic`      | On `<html>` while the classic look is on                   |
| `.toolbox-nxg-v8` and friends | On `<html>` and `<body>`, by version                       |

The classic look is described in [General Settings](general.md#classic-look), and the version classes in [Getting started](../getting-started.md#targeting-toolbox-nxg-from-a-subreddit-stylesheet).

## Examples

Toolbox's own rules are often quite specific. If one of your rules has no effect, make it more specific or add `!important`. For example, to make the modbar counts bold:

```css
.toolbox-scope .toolbox-toolbarcounters .toolbox-counter-badge {
	font-weight: bold;
}
```

To hide the version label on beta builds without turning on the reminder popup that the modbar's "Show the version label" setting brings up:

```css
.toolbox-prerelease-link {
	display: none;
}
```

## Limits

Custom CSS cannot change the inside of Reddit's own components on new Reddit (such as the vote buttons), because Reddit keeps those sealed off from page styles. Your CSS is never included in the anonymized settings you share for support.
