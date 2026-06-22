# Configuration file for the Sphinx documentation builder.
# https://www.sphinx-doc.org/en/master/usage/configuration.html

project = "Moderator Toolbox-NXG"
author = "The Toolbox-NXG Contributors"
copyright = "The Toolbox-NXG Contributors"

extensions = [
    "myst_parser",
    "sphinx_copybutton",
    "sphinx_design",
    "sphinx.ext.githubpages",  # writes .nojekyll for GitHub Pages
]

source_suffix = {".md": "myst"}
master_doc = "index"

exclude_patterns = [
    "_build",
    # TypeDoc output is gitignored and only present after `npm run docs:api`.
    # When present, Sphinx picks it up automatically; no exclude needed.
]

html_theme = "furo"
html_title = "Moderator Toolbox-NXG"
html_logo = "../extension/data/images/icon256.png"

html_theme_options = {
    "source_repository": "https://github.com/toolbox-nxg/toolbox-nxg",
    "source_branch": "main",
    "source_directory": "docs/",
}

# myst.xref_missing: TypeDoc maps a few project-internal symbols (that are
# intentionally unexported) to "#", which MyST parses as an empty anchor
# cross-reference. All such warnings originate from auto-generated API docs.
# misc.highlighting_failure: React's own JSDoc has a JSX code example that
# the Pygments TS lexer can't tokenise; it retries in relaxed mode successfully.
suppress_warnings = ["myst.xref_missing", "misc.highlighting_failure"]

myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "tasklist",
    "attrs_inline",
]
myst_heading_anchors = 3
